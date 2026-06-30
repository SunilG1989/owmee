/**
 * Admin Audit Log page — Sprint 4 / Pass 4f
 */
import React, { useEffect, useState } from 'react';
import { AdminAuditLog } from '../api';

interface LogItem {
  id: string;
  admin_user_id: string;
  admin_email: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  reviewer_notes: string | null;
  ip_address: string | null;
  mfa_verified: boolean;
  created_at: string;
  before_state: Record<string, any>;
  after_state: Record<string, any>;
}

export default function AuditLogPage() {
  const [items, setItems] = useState<LogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [actions, setActions] = useState<{ action: string; count: number }[]>([]);
  const [filter, setFilter] = useState({
    action: '',
    entity_type: '',
    entity_id: '',
    admin_id: '',
    q: '',
    created_from: '',
    created_to: '',
    high_risk_only: false,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { limit: 50 };
      if (filter.action) params.action = filter.action;
      if (filter.entity_type) params.entity_type = filter.entity_type;
      if (filter.entity_id) params.entity_id = filter.entity_id;
      if (filter.admin_id) params.admin_id = filter.admin_id;
      if (filter.q.trim().length >= 2) params.q = filter.q.trim();
      if (filter.created_from) params.created_from = new Date(filter.created_from).toISOString();
      if (filter.created_to) params.created_to = new Date(filter.created_to).toISOString();
      if (filter.high_risk_only) params.high_risk_only = 'true';
      const r: any = await AdminAuditLog.list(params);
      setItems(r.items || []);
      setTotal(r.total || 0);
      setError(null);
    } catch (e: any) {
      setError(e.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  const loadActions = async () => {
    try {
      const r: any = await AdminAuditLog.actions();
      setActions(r.actions || []);
    } catch {/* non-critical */}
  };

  useEffect(() => { load(); }, [filter]);
  useEffect(() => { loadActions(); }, []);

  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ marginBottom: 8 }}>Audit Log</h1>
      <p style={{ color: '#666', marginBottom: 24 }}>
        Append-only record of every admin action. Showing {items.length} of {total} total.
      </p>

      <div style={{ marginBottom: 16, display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', alignItems: 'end' }}>
        <label>
          Search:{' '}
          <input
            value={filter.q}
            onChange={(e) => setFilter({ ...filter, q: e.target.value })}
            placeholder="email, note, action"
            style={{ padding: 6, border: '1px solid #ddd', borderRadius: 4, width: '100%' }}
          />
        </label>
        <label>
          Action:{' '}
          <select
            value={filter.action}
            onChange={(e) => setFilter({ ...filter, action: e.target.value })}
            style={{ padding: 6 }}
          >
            <option value="">— all —</option>
            {actions.map((a) => (
              <option key={a.action} value={a.action}>
                {a.action} ({a.count})
              </option>
            ))}
          </select>
        </label>
        <label>
          Entity type:{' '}
          <input
            value={filter.entity_type}
            onChange={(e) => setFilter({ ...filter, entity_type: e.target.value })}
            placeholder="e.g., listing"
            style={{ padding: 6, border: '1px solid #ddd', borderRadius: 4, width: '100%' }}
          />
        </label>
        <label>
          Entity ID:{' '}
          <input
            value={filter.entity_id}
            onChange={(e) => setFilter({ ...filter, entity_id: e.target.value })}
            placeholder="transaction/listing id"
            style={{ padding: 6, border: '1px solid #ddd', borderRadius: 4, width: '100%' }}
          />
        </label>
        <label>
          Admin ID:{' '}
          <input
            value={filter.admin_id}
            onChange={(e) => setFilter({ ...filter, admin_id: e.target.value })}
            placeholder="admin UUID"
            style={{ padding: 6, border: '1px solid #ddd', borderRadius: 4, width: '100%' }}
          />
        </label>
        <label>
          From:{' '}
          <input
            type="datetime-local"
            value={filter.created_from}
            onChange={(e) => setFilter({ ...filter, created_from: e.target.value })}
            style={{ padding: 6, border: '1px solid #ddd', borderRadius: 4, width: '100%' }}
          />
        </label>
        <label>
          To:{' '}
          <input
            type="datetime-local"
            value={filter.created_to}
            onChange={(e) => setFilter({ ...filter, created_to: e.target.value })}
            style={{ padding: 6, border: '1px solid #ddd', borderRadius: 4, width: '100%' }}
          />
        </label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', paddingBottom: 6 }}>
          <input
            type="checkbox"
            checked={filter.high_risk_only}
            onChange={(e) => setFilter({ ...filter, high_risk_only: e.target.checked })}
          />
          High-risk only
        </label>
        <button onClick={load} style={{ padding: '6px 14px' }}>Refresh</button>
      </div>

      {loading && <p>Loading…</p>}
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      {!loading && items.length === 0 && <p style={{ color: '#888' }}>No entries match.</p>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {items.map((it) => (
          <div
            key={it.id}
            style={{
              background: '#fff',
              border: '1px solid #e0e0e0',
              borderRadius: 4,
              padding: 10,
              fontSize: 13,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <div>
                <strong>{it.action}</strong>
                {' · '}
                <span style={{ color: '#666' }}>
                  {it.admin_email || it.admin_user_id.slice(0, 8)}
                </span>
                {it.entity_type && (
                  <>
                    {' → '}
                    <span style={{ color: '#444' }}>
                      {it.entity_type}:<code>{(it.entity_id || '').slice(0, 10)}</code>
                    </span>
                  </>
                )}
                {it.mfa_verified && (
                  <span style={{
                    marginLeft: 8, background: '#e6f5ec', color: '#1f6b3a',
                    padding: '1px 6px', borderRadius: 3, fontSize: 11,
                  }}>
                    MFA
                  </span>
                )}
              </div>
              <div style={{ color: '#888' }}>
                {new Date(it.created_at).toLocaleString('en-IN')}
                {' · '}
                <button
                  onClick={() => setExpandedId(expandedId === it.id ? null : it.id)}
                  style={{ background: 'none', border: 'none', color: '#4b94d6', cursor: 'pointer', padding: 0 }}
                >
                  {expandedId === it.id ? 'hide' : 'details'}
                </button>
              </div>
            </div>
            {expandedId === it.id && (
              <div style={{ marginTop: 8, padding: 8, background: '#f4f4f4', borderRadius: 3 }}>
                {it.reviewer_notes && (
                  <div style={{ marginBottom: 6 }}>
                    <strong>Notes:</strong> {it.reviewer_notes}
                  </div>
                )}
                <div style={{ marginBottom: 4 }}>
                  <strong>Before:</strong>
                  <pre style={{ fontSize: 11, background: '#fff', padding: 6, marginTop: 2 }}>
                    {JSON.stringify(it.before_state, null, 2)}
                  </pre>
                </div>
                <div>
                  <strong>After:</strong>
                  <pre style={{ fontSize: 11, background: '#fff', padding: 6, marginTop: 2 }}>
                    {JSON.stringify(it.after_state, null, 2)}
                  </pre>
                </div>
                {it.ip_address && (
                  <div style={{ color: '#888', fontSize: 11 }}>IP: {it.ip_address}</div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
