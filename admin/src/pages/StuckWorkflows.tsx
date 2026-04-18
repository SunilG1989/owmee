/**
 * Stuck Workflows admin page — Sprint 4 / Pass 4b
 */
import React, { useEffect, useState } from 'react';
import { AdminStuckWorkflows } from '../api';

interface Alert {
  id: string;
  workflow_type: string;
  workflow_id: string;
  entity_type: string | null;
  entity_id: string | null;
  reason: string;
  severity: string;
  description: string | null;
  first_seen_at: string;
  last_seen_at: string;
  resolved_at: string | null;
  resolved_by_admin_id: string | null;
  resolution_note: string | null;
}

export default function StuckWorkflowsPage() {
  const [items, setItems] = useState<Alert[]>([]);
  const [totalOpen, setTotalOpen] = useState(0);
  const [totalResolved7d, setTotalResolved7d] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'open' | 'resolved' | 'all'>('open');
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [resolveNote, setResolveNote] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const r: any = await AdminStuckWorkflows.list(filter);
      setItems(r.items || []);
      setTotalOpen(r.total_open || 0);
      setTotalResolved7d(r.total_resolved_last_7d || 0);
      setError(null);
    } catch (e: any) {
      setError(e.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [filter]);

  const resolve = async (alertId: string) => {
    if (!resolveNote.trim()) {
      alert('Please enter a resolution note.');
      return;
    }
    try {
      await AdminStuckWorkflows.resolve(alertId, resolveNote);
      setResolvingId(null);
      setResolveNote('');
      load();
    } catch (e: any) {
      alert(e.message || 'Failed to resolve');
    }
  };

  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ marginBottom: 8 }}>Stuck Workflows</h1>
      <p style={{ color: '#666', marginBottom: 24 }}>
        Workflows waiting for manual intervention, timed out, or missing external callbacks.
        <span style={{ marginLeft: 16 }}>
          <strong>{totalOpen}</strong> open ·{' '}
          <strong>{totalResolved7d}</strong> resolved in last 7 days
        </span>
      </p>

      <div style={{ marginBottom: 16 }}>
        {(['open', 'resolved', 'all'] as const).map((k) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            style={{
              marginRight: 8,
              padding: '6px 14px',
              background: filter === k ? '#333' : '#fff',
              color: filter === k ? '#fff' : '#333',
              border: '1px solid #ddd',
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            {k[0].toUpperCase() + k.slice(1)}
          </button>
        ))}
        <button onClick={load} style={{ marginLeft: 16, padding: '6px 14px' }}>
          Refresh
        </button>
      </div>

      {loading && <p>Loading…</p>}
      {error && <p style={{ color: 'crimson' }}>{error}</p>}

      {!loading && items.length === 0 && (
        <p style={{ color: '#888' }}>No {filter} alerts.</p>
      )}

      <div style={{ display: 'grid', gap: 12 }}>
        {items.map((a) => (
          <div
            key={a.id}
            style={{
              background: '#fff',
              border: `1px solid ${a.severity === 'critical' ? '#e64141' : '#ddd'}`,
              borderLeft: `4px solid ${
                a.severity === 'critical' ? '#e64141' :
                a.severity === 'warning' ? '#e6a847' : '#4b94d6'
              }`,
              borderRadius: 6,
              padding: 16,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <strong>{a.workflow_type}</strong>
              <span style={{ fontSize: 13, color: '#888' }}>{a.severity.toUpperCase()}</span>
            </div>
            <div style={{ fontSize: 13, color: '#555', marginBottom: 4 }}>
              Workflow ID: <code>{a.workflow_id}</code>
            </div>
            <div style={{ fontSize: 13, color: '#555', marginBottom: 4 }}>
              Reason: <strong>{a.reason}</strong>
              {a.entity_type && a.entity_id && (
                <> · Entity: {a.entity_type}:<code>{a.entity_id}</code></>
              )}
            </div>
            {a.description && (
              <div style={{ fontSize: 13, marginTop: 6 }}>{a.description}</div>
            )}
            <div style={{ fontSize: 12, color: '#888', marginTop: 8 }}>
              First seen: {new Date(a.first_seen_at).toLocaleString('en-IN')}
              {' · '}Last seen: {new Date(a.last_seen_at).toLocaleString('en-IN')}
            </div>

            {a.resolved_at ? (
              <div style={{
                marginTop: 12, padding: 8, background: '#f4f4f4',
                borderRadius: 4, fontSize: 13, color: '#333',
              }}>
                ✓ Resolved {new Date(a.resolved_at).toLocaleString('en-IN')}
                {a.resolution_note && <>: {a.resolution_note}</>}
              </div>
            ) : resolvingId === a.id ? (
              <div style={{ marginTop: 12 }}>
                <input
                  value={resolveNote}
                  onChange={(e) => setResolveNote(e.target.value)}
                  placeholder="Resolution note (required)"
                  style={{ width: '60%', padding: 6, marginRight: 8 }}
                />
                <button onClick={() => resolve(a.id)} style={{ padding: '6px 14px', background: '#2f855a', color: '#fff', border: 'none', borderRadius: 4 }}>
                  Resolve
                </button>
                <button onClick={() => { setResolvingId(null); setResolveNote(''); }} style={{ marginLeft: 8, padding: '6px 14px' }}>
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setResolvingId(a.id)}
                style={{
                  marginTop: 12, padding: '6px 14px',
                  background: '#f4f4f4', border: '1px solid #ddd',
                  borderRadius: 4, cursor: 'pointer',
                }}
              >
                Mark resolved
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
