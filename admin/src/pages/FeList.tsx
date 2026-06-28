import { useEffect, useMemo, useState } from 'react';
import { AdminFE } from '../api';

type EmploymentType = 'internal' | 'contractor' | 'vendor_staff';

interface FE {
  id: string;
  user_id: string;
  fe_code: string;
  city: string;
  active: boolean;
  current_shift: string;
  onboarding_status: string;
  verification_status: string;
  training_status: string;
  device_status: string;
  employment_type: EmploymentType;
  vendor_name?: string | null;
  service_zones: string[];
  category_certifications: string[];
  languages: string[];
  daily_capacity: number;
  readiness_gaps: string[];
  device_binding: Record<string, unknown>;
  suspended_reason?: string | null;
  admin_notes?: string | null;
  verified_at?: string | null;
  certified_at?: string | null;
  device_approved_at?: string | null;
  activated_at?: string | null;
  suspended_at?: string | null;
  last_seen_at?: string | null;
  shift_started_at?: string | null;
  created_at: string;
}

const GAP_LABELS: Record<string, string> = {
  verification_not_approved: 'Verification pending',
  training_not_certified: 'Training pending',
  device_not_approved: 'Device approval pending',
  service_zones_missing: 'Service zone missing',
  category_certification_missing: 'Category certification missing',
  capacity_missing: 'Daily capacity missing',
  suspended: 'Suspended',
  rejected: 'Rejected',
  deactivated: 'Deactivated',
};

const CATEGORY_PRESETS = ['*', 'toys', 'books', 'home-appliances', 'kids-utility', 'small-appliances'];
const ZONE_PRESETS = ['Bengaluru', 'Bengaluru Urban', 'HSR Layout', 'Koramangala', 'Jayanagar', 'Whitefield'];

function splitCsv(value: string): string[] {
  return Array.from(new Set(value.split(',').map((v) => v.trim()).filter(Boolean)));
}

function joinList(values?: string[]): string {
  return (values || []).join(', ');
}

function fmt(value?: string | null): string {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return value;
  }
}

function statusClass(status: string): string {
  if (['active', 'approved', 'certified', 'device_ready'].includes(status)) return 'pill-success';
  if (['candidate', 'verification_pending', 'training_pending', 'pending', 'not_started', 'pending_admin_approval'].includes(status)) return 'pill-warn';
  if (['suspended', 'rejected', 'deactivated', 'failed', 'expired', 'blocked'].includes(status)) return 'pill-danger';
  return 'bg-bone2 text-ink2';
}

export default function FeList() {
  const [fes, setFes] = useState<FE[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [message, setMessage] = useState('');
  const [activeOnly, setActiveOnly] = useState(false);
  const [form, setForm] = useState({
    phone_number: '',
    city: 'Bengaluru',
    employment_type: 'contractor' as EmploymentType,
    vendor_name: '',
    service_zones: 'Bengaluru',
    category_certifications: 'toys, books, home-appliances',
    languages: 'Kannada, English, Hindi',
    daily_capacity: 4,
    admin_notes: '',
  });

  const summary = useMemo(() => {
    const active = fes.filter((fe) => fe.active).length;
    const blocked = fes.filter((fe) => ['suspended', 'rejected', 'deactivated'].includes(fe.onboarding_status)).length;
    const pending = fes.length - active - blocked;
    return { active, pending, blocked };
  }, [fes]);

  const load = async () => {
    setLoading(true);
    setErr('');
    try {
      const r: any = await AdminFE.listFEs(activeOnly);
      setFes(Array.isArray(r) ? r : r?.fes || []);
    } catch (e: any) {
      setErr(e.message || 'Failed to load FEs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [activeOnly]);

  const createInvite = async () => {
    if (!form.phone_number.trim()) {
      setErr('Phone number is required.');
      return;
    }
    setBusyId('create');
    setErr('');
    setMessage('');
    try {
      const created: any = await AdminFE.createFE({
        phone_number: form.phone_number.trim(),
        city: form.city.trim(),
        employment_type: form.employment_type,
        vendor_name: form.vendor_name.trim() || undefined,
        service_zones: splitCsv(form.service_zones),
        category_certifications: splitCsv(form.category_certifications),
        languages: splitCsv(form.languages),
        daily_capacity: Number(form.daily_capacity),
        admin_notes: form.admin_notes.trim() || undefined,
      });
      setMessage(`Created FE invite ${created.fe_code}. Ask the FE to OTP login and bind their device.`);
      setForm((prev) => ({ ...prev, phone_number: '', admin_notes: '' }));
      await load();
    } catch (e: any) {
      setErr(e.message || 'Could not create FE invite');
    } finally {
      setBusyId(null);
    }
  };

  const mutate = async (fe: FE, label: string, fn: () => Promise<unknown>) => {
    setBusyId(`${label}:${fe.id}`);
    setErr('');
    setMessage('');
    try {
      await fn();
      setMessage(`${fe.fe_code}: ${label} completed.`);
      await load();
    } catch (e: any) {
      setErr(e.message || `${label} failed`);
    } finally {
      setBusyId(null);
    }
  };

  const updateCsv = async (fe: FE, field: 'service_zones' | 'category_certifications' | 'languages') => {
    const current = joinList(fe[field]);
    const next = window.prompt(`Update ${field.replace(/_/g, ' ')} as comma-separated values`, current);
    if (next === null) return;
    await mutate(fe, `Update ${field.replace(/_/g, ' ')}`, () => AdminFE.updateFE(fe.id, { [field]: splitCsv(next) }));
  };

  const updateCapacity = async (fe: FE) => {
    const next = window.prompt('Daily visit capacity', String(fe.daily_capacity || 4));
    if (next === null) return;
    const value = Number(next);
    if (!Number.isFinite(value) || value < 1 || value > 12) {
      setErr('Daily capacity must be between 1 and 12.');
      return;
    }
    await mutate(fe, 'Update capacity', () => AdminFE.updateFE(fe.id, { daily_capacity: value }));
  };

  const suspend = async (fe: FE) => {
    const reason = window.prompt('Suspension reason. This is required and visible in ops audit.');
    if (!reason?.trim()) return;
    await mutate(fe, 'Suspend FE', () => AdminFE.suspendFE(fe.id, reason.trim()));
  };

  const deactivate = async (fe: FE) => {
    const reason = window.prompt('Deactivation reason');
    if (reason === null) return;
    await mutate(fe, 'Deactivate FE', () => AdminFE.deactivateFE(fe.id, reason.trim() || undefined));
  };

  return (
    <div>
      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4 mb-5">
        <div>
          <h1 className="text-2xl font-bold text-ink">Field executives</h1>
          <p className="text-sm text-ink3 mt-0.5">
            Onboard, certify, activate, suspend, and audit FE readiness before assigning work.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="pill pill-success">{summary.active} active</span>
          <span className="pill pill-warn">{summary.pending} onboarding</span>
          <span className="pill pill-danger">{summary.blocked} blocked</span>
          <label className="flex items-center gap-2 text-sm text-ink2 ml-2">
            <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} />
            Active only
          </label>
          <button className="btn-secondary" onClick={load} disabled={loading}>Refresh</button>
        </div>
      </div>

      <div className="card mb-5 p-4">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <div className="text-sm font-semibold text-ink">Create FE invite</div>
            <div className="text-xs text-ink3">
              Creates or links an OTP user, then starts onboarding. Activation is blocked until all P0 checks pass.
            </div>
          </div>
          <span className="pill bg-bone2 text-ink2">Admin-controlled</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          <Field label="Phone">
            <input className="input" placeholder="+918095918925" value={form.phone_number} onChange={(e) => setForm({ ...form, phone_number: e.target.value })} />
          </Field>
          <Field label="City">
            <input className="input" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
          </Field>
          <Field label="Employment">
            <select className="input" value={form.employment_type} onChange={(e) => setForm({ ...form, employment_type: e.target.value as EmploymentType })}>
              <option value="contractor">Contractor</option>
              <option value="internal">Internal</option>
              <option value="vendor_staff">Vendor staff</option>
            </select>
          </Field>
          <Field label="Vendor">
            <input className="input" placeholder="Optional" value={form.vendor_name} onChange={(e) => setForm({ ...form, vendor_name: e.target.value })} />
          </Field>
          <Field label="Service zones">
            <input className="input" list="zone-presets" value={form.service_zones} onChange={(e) => setForm({ ...form, service_zones: e.target.value })} />
          </Field>
          <Field label="Category certifications">
            <input className="input" list="category-presets" value={form.category_certifications} onChange={(e) => setForm({ ...form, category_certifications: e.target.value })} />
          </Field>
          <Field label="Languages">
            <input className="input" value={form.languages} onChange={(e) => setForm({ ...form, languages: e.target.value })} />
          </Field>
          <Field label="Daily capacity">
            <input className="input" type="number" min={1} max={12} value={form.daily_capacity} onChange={(e) => setForm({ ...form, daily_capacity: Number(e.target.value) })} />
          </Field>
          <div className="md:col-span-2 xl:col-span-3">
            <Field label="Admin notes">
              <input className="input" placeholder="Background check references, vendor details, training batch..." value={form.admin_notes} onChange={(e) => setForm({ ...form, admin_notes: e.target.value })} />
            </Field>
          </div>
          <div className="flex items-end">
            <button className="btn-primary w-full" onClick={createInvite} disabled={busyId === 'create'}>
              {busyId === 'create' ? 'Creating...' : 'Create invite'}
            </button>
          </div>
        </div>
        <datalist id="zone-presets">{ZONE_PRESETS.map((z) => <option key={z} value={z} />)}</datalist>
        <datalist id="category-presets">{CATEGORY_PRESETS.map((c) => <option key={c} value={c} />)}</datalist>
      </div>

      {err ? <div className="mb-4 rounded-md bg-red-50 text-red-700 px-4 py-3 text-sm">{err}</div> : null}
      {message ? <div className="mb-4 rounded-md bg-emerald-50 text-emerald-800 px-4 py-3 text-sm">{message}</div> : null}

      {loading ? (
        <div className="text-ink3">Loading...</div>
      ) : fes.length === 0 ? (
        <div className="card text-center py-10 text-ink3">No FEs found.</div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {fes.map((fe) => (
            <FECard
              key={fe.id}
              fe={fe}
              busy={Boolean(busyId?.endsWith(fe.id))}
              onVerify={() => mutate(fe, 'Approve verification', () => AdminFE.updateFEVerification(fe.id, 'approved', 'Admin verified identity/KYC documents.'))}
              onRejectVerification={() => mutate(fe, 'Reject verification', () => AdminFE.updateFEVerification(fe.id, 'rejected', window.prompt('Verification rejection reason') || 'Rejected by admin'))}
              onCertify={() => mutate(fe, 'Certify training', () => AdminFE.updateFETraining(fe.id, 'certified', 'Training completed.'))}
              onExpireTraining={() => mutate(fe, 'Expire training', () => AdminFE.updateFETraining(fe.id, 'expired', 'Training expired or failed audit.'))}
              onApproveDevice={() => mutate(fe, 'Approve device', () => AdminFE.decideFEDevice(fe.id, true, 'Device binding approved by admin.'))}
              onBlockDevice={() => mutate(fe, 'Block device', () => AdminFE.decideFEDevice(fe.id, false, window.prompt('Device block reason') || 'Device blocked by admin'))}
              onActivate={() => mutate(fe, 'Activate FE', () => AdminFE.activateFE(fe.id))}
              onSuspend={() => suspend(fe)}
              onDeactivate={() => deactivate(fe)}
              onZones={() => updateCsv(fe, 'service_zones')}
              onCategories={() => updateCsv(fe, 'category_certifications')}
              onLanguages={() => updateCsv(fe, 'languages')}
              onCapacity={() => updateCapacity(fe)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FECard({
  fe,
  busy,
  onVerify,
  onRejectVerification,
  onCertify,
  onExpireTraining,
  onApproveDevice,
  onBlockDevice,
  onActivate,
  onSuspend,
  onDeactivate,
  onZones,
  onCategories,
  onLanguages,
  onCapacity,
}: {
  fe: FE;
  busy: boolean;
  onVerify: () => void;
  onRejectVerification: () => void;
  onCertify: () => void;
  onExpireTraining: () => void;
  onApproveDevice: () => void;
  onBlockDevice: () => void;
  onActivate: () => void;
  onSuspend: () => void;
  onDeactivate: () => void;
  onZones: () => void;
  onCategories: () => void;
  onLanguages: () => void;
  onCapacity: () => void;
}) {
  const gaps = fe.readiness_gaps || [];
  const hasDeviceRequest = Boolean(fe.device_binding?.device_id);
  const canActivate = !fe.active && gaps.length === 0;

  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-base font-bold text-ink">{fe.fe_code}</span>
            <span className={`pill ${statusClass(fe.onboarding_status)}`}>{fe.onboarding_status.replace(/_/g, ' ')}</span>
            <span className={`pill ${fe.active ? 'pill-success' : 'bg-gray-100 text-gray-600'}`}>{fe.active ? 'active' : 'inactive'}</span>
          </div>
          <div className="text-sm text-ink3 mt-1">
            {fe.city} · {fe.employment_type.replace(/_/g, ' ')}
            {fe.vendor_name ? ` · ${fe.vendor_name}` : ''}
          </div>
        </div>
        <div className="text-right text-xs text-ink3">
          <div>Created {fmt(fe.created_at)}</div>
          <div>Last seen {fmt(fe.last_seen_at)}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-4">
        <CheckCard label="Verification" value={fe.verification_status} when={fe.verified_at} />
        <CheckCard label="Training" value={fe.training_status} when={fe.certified_at} />
        <CheckCard label="Device" value={fe.device_status} when={fe.device_approved_at} />
        <CheckCard label="Shift" value={fe.current_shift} when={fe.shift_started_at} />
      </div>

      <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
        <InfoBlock label="Zones" value={joinList(fe.service_zones) || 'Missing'} onEdit={onZones} />
        <InfoBlock label="Categories" value={joinList(fe.category_certifications) || 'Missing'} onEdit={onCategories} />
        <InfoBlock label="Languages" value={joinList(fe.languages) || 'Missing'} onEdit={onLanguages} />
        <InfoBlock label="Daily capacity" value={String(fe.daily_capacity || 'Missing')} onEdit={onCapacity} />
        <InfoBlock label="Device id" value={String(fe.device_binding?.device_id || 'Not bound')} />
        <InfoBlock label="User id" value={fe.user_id} mono />
      </div>

      <div className="mt-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-ink3 mb-2">Readiness</div>
        {gaps.length === 0 ? (
          <div className="rounded-md bg-emerald-50 text-emerald-800 px-3 py-2 text-sm">
            All P0 gates are complete. {fe.active ? 'FE can receive work.' : 'Activation is now allowed.'}
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {gaps.map((gap) => (
              <span key={gap} className="pill pill-warn">{GAP_LABELS[gap] || gap.replace(/_/g, ' ')}</span>
            ))}
          </div>
        )}
        {fe.suspended_reason ? <div className="text-sm text-red-700 mt-2">Suspension: {fe.suspended_reason}</div> : null}
        {fe.admin_notes ? <div className="text-sm text-ink3 mt-2">Notes: {fe.admin_notes}</div> : null}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button className="btn-secondary" disabled={busy || fe.verification_status === 'approved'} onClick={onVerify}>Approve verification</button>
        <button className="btn-secondary" disabled={busy || ['rejected', 'deactivated'].includes(fe.onboarding_status)} onClick={onCertify}>Certify training</button>
        <button className="btn-secondary" disabled={busy || !hasDeviceRequest || fe.device_status === 'approved'} onClick={onApproveDevice}>Approve device</button>
        <button className="btn-primary" disabled={busy || !canActivate} onClick={onActivate}>Activate</button>
        <button className="btn-ghost" disabled={busy || fe.verification_status === 'rejected'} onClick={onRejectVerification}>Reject verification</button>
        <button className="btn-ghost" disabled={busy || fe.training_status === 'expired'} onClick={onExpireTraining}>Expire training</button>
        <button className="btn-ghost" disabled={busy || fe.device_status === 'blocked'} onClick={onBlockDevice}>Block device</button>
        <button className="btn-danger" disabled={busy || fe.onboarding_status === 'suspended'} onClick={onSuspend}>Suspend</button>
        <button className="btn-ghost" disabled={busy || fe.onboarding_status === 'deactivated'} onClick={onDeactivate}>Deactivate</button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-xs font-semibold text-ink3 uppercase tracking-wide mb-1">{label}</div>
      {children}
    </label>
  );
}

function CheckCard({ label, value, when }: { label: string; value: string; when?: string | null }) {
  return (
    <div className="rounded-md border border-bone2 bg-bone p-3">
      <div className="text-xs text-ink3 mb-1">{label}</div>
      <span className={`pill ${statusClass(value)}`}>{value.replace(/_/g, ' ')}</span>
      <div className="text-xs text-ink3 mt-2">{fmt(when)}</div>
    </div>
  );
}

function InfoBlock({ label, value, onEdit, mono = false }: { label: string; value: string; onEdit?: () => void; mono?: boolean }) {
  return (
    <div className="rounded-md border border-bone2 bg-white px-3 py-2 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs text-ink3">{label}</div>
        {onEdit ? <button className="text-xs text-petrol-700 font-semibold" onClick={onEdit}>Edit</button> : null}
      </div>
      <div className={`mt-1 text-ink truncate ${mono ? 'font-mono text-xs' : ''}`}>{value}</div>
    </div>
  );
}
