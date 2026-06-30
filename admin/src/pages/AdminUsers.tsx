import { useEffect, useMemo, useState } from 'react';
import { AdminOpsControl } from '../api';

interface RoleDefinition {
  role: string;
  label: string;
  description: string;
  capabilities: string[];
}

interface AdminUserRow {
  id: string;
  email: string;
  name: string;
  role: string;
  is_active: boolean;
  mfa_enabled: boolean;
  last_login_at: string | null;
  created_at: string | null;
}

interface DraftRow {
  name: string;
  role: string;
  is_active: boolean;
  reason: string;
  resetReason: string;
}

export default function AdminUsersPage() {
  const [admins, setAdmins] = useState<AdminUserRow[]>([]);
  const [roles, setRoles] = useState<RoleDefinition[]>([]);
  const [drafts, setDrafts] = useState<Record<string, DraftRow>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const rolesById = useMemo(() => new Map(roles.map((r) => [r.role, r])), [roles]);

  const load = async (clearNotice = true) => {
    setLoading(true);
    setError('');
    if (clearNotice) setNotice('');
    try {
      const [roleRows, adminRows]: any[] = await Promise.all([
        AdminOpsControl.roles(),
        AdminOpsControl.admins(),
      ]);
      const list = Array.isArray(adminRows) ? adminRows : [];
      setRoles(Array.isArray(roleRows) ? roleRows : []);
      setAdmins(list);
      const nextDrafts: Record<string, DraftRow> = {};
      list.forEach((a: AdminUserRow) => {
        nextDrafts[a.id] = {
          name: a.name,
          role: a.role,
          is_active: a.is_active,
          reason: '',
          resetReason: '',
        };
      });
      setDrafts(nextDrafts);
    } catch (e: any) {
      setError(e.status === 403
        ? 'Only super admins can manage admin users.'
        : (e.message || 'Failed to load admin users'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const updateDraft = (id: string, patch: Partial<DraftRow>) => {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  };

  const save = async (admin: AdminUserRow) => {
    const draft = drafts[admin.id];
    if (!draft?.reason || draft.reason.trim().length < 8) {
      setError('Add a reason with at least 8 characters before saving.');
      return;
    }
    setSavingId(admin.id);
    setError('');
    setNotice('');
    try {
      await AdminOpsControl.updateAdmin(admin.id, {
        name: draft.name.trim(),
        role: draft.role,
        is_active: draft.is_active,
        reason: draft.reason.trim(),
      });
      setNotice(`Updated ${admin.email}`);
      await load(false);
    } catch (e: any) {
      setError(e.detail?.message || e.message || 'Update failed');
    } finally {
      setSavingId(null);
    }
  };

  const resetPassword = async (admin: AdminUserRow) => {
    const draft = drafts[admin.id];
    if (!draft?.resetReason || draft.resetReason.trim().length < 8) {
      setError('Add a password-reset reason with at least 8 characters.');
      return;
    }
    setSavingId(admin.id);
    setError('');
    setNotice('');
    try {
      const r: any = await AdminOpsControl.resetPassword(admin.id, draft.resetReason.trim());
      setNotice(`Temporary password for ${admin.email}: ${r.temp_password}`);
      await load(false);
    } catch (e: any) {
      setError(e.detail?.message || e.message || 'Password reset failed');
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-ink">Admin users</h1>
          <p className="text-sm text-ink3 mt-0.5">
            Super-admin governance for roles, account status, and emergency password resets.
          </p>
        </div>
        <button onClick={() => load()} className="btn-secondary text-sm">Refresh</button>
      </div>

      {notice && <div className="card mb-4 border-green-200 bg-green-50 text-green-800 text-sm">{notice}</div>}
      {error && <div className="card mb-4 border-red-200 bg-red-50 text-red-800 text-sm">{error}</div>}

      {loading ? (
        <div className="text-ink3 text-sm">Loading...</div>
      ) : (
        <div className="grid gap-4">
          <section className="card">
            <h2 className="font-semibold text-ink mb-3">Role map</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {roles.map((role) => (
                <div key={role.role} className="border border-ink4 rounded-md p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-medium text-ink">{role.label}</div>
                    <code className="text-xs bg-bone2 px-2 py-1 rounded">{role.role}</code>
                  </div>
                  <div className="text-xs text-ink3 mt-1">{role.description}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="grid gap-3">
            {admins.map((admin) => {
              const draft = drafts[admin.id];
              const role = rolesById.get(admin.role);
              return (
                <div key={admin.id} className="card">
                  <div className="grid grid-cols-1 xl:grid-cols-[1.2fr_1.5fr] gap-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <h2 className="font-semibold text-ink">{admin.email}</h2>
                        <span className={`pill ${admin.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700'}`}>
                          {admin.is_active ? 'active' : 'inactive'}
                        </span>
                        {admin.mfa_enabled && <span className="pill bg-blue-100 text-blue-800">MFA</span>}
                      </div>
                      <div className="text-sm text-ink2 mt-1">{admin.name}</div>
                      <div className="text-xs text-ink3 mt-2">
                        {role?.label || admin.role} · Last login {admin.last_login_at
                          ? new Date(admin.last_login_at).toLocaleString('en-IN')
                          : 'never'}
                      </div>
                    </div>

                    <div className="grid gap-3">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                        <label className="text-xs text-ink3">
                          Name
                          <input
                            className="mt-1 w-full border border-ink4 rounded-md px-2 py-2 text-sm text-ink"
                            value={draft?.name || ''}
                            onChange={(e) => updateDraft(admin.id, { name: e.target.value })}
                          />
                        </label>
                        <label className="text-xs text-ink3">
                          Role
                          <select
                            className="mt-1 w-full border border-ink4 rounded-md px-2 py-2 text-sm text-ink"
                            value={draft?.role || admin.role}
                            onChange={(e) => updateDraft(admin.id, { role: e.target.value })}
                          >
                            {roles.map((r) => <option key={r.role} value={r.role}>{r.label}</option>)}
                          </select>
                        </label>
                        <label className="text-xs text-ink3 flex flex-col justify-end">
                          Account
                          <span className="mt-1 inline-flex items-center gap-2 border border-ink4 rounded-md px-2 py-2 text-sm text-ink">
                            <input
                              type="checkbox"
                              checked={!!draft?.is_active}
                              onChange={(e) => updateDraft(admin.id, { is_active: e.target.checked })}
                            />
                            Active
                          </span>
                        </label>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2">
                        <input
                          className="border border-ink4 rounded-md px-2 py-2 text-sm"
                          value={draft?.reason || ''}
                          onChange={(e) => updateDraft(admin.id, { reason: e.target.value })}
                          placeholder="Reason for role/status/name change"
                        />
                        <button
                          onClick={() => save(admin)}
                          disabled={savingId === admin.id}
                          className="btn-primary text-sm"
                        >
                          Save changes
                        </button>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2">
                        <input
                          className="border border-ink4 rounded-md px-2 py-2 text-sm"
                          value={draft?.resetReason || ''}
                          onChange={(e) => updateDraft(admin.id, { resetReason: e.target.value })}
                          placeholder="Reason for password reset"
                        />
                        <button
                          onClick={() => resetPassword(admin)}
                          disabled={savingId === admin.id || !admin.is_active}
                          className="btn-secondary text-sm"
                        >
                          Reset password
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </section>
        </div>
      )}
    </div>
  );
}
