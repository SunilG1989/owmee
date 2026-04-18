import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AdminFE } from '../api';

interface Visit {
  id: string;
  seller_id: string;
  fe_id: string | null;
  fe_code: string | null;
  status: string;
  category_hint: string;
  category_name: string | null;
  category_id: string | null;
  address: any;
  requested_slot_start: string;
  requested_slot_end: string;
  scheduled_slot_start: string | null;
  workflow_id: string | null;
  created_at: string;
}

const STATUS_FILTERS = [
  { key: '', label: 'All' },
  { key: 'requested', label: 'Requested' },
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'in_progress', label: 'In progress' },
  { key: 'completed', label: 'Completed' },
  { key: 'cancelled', label: 'Cancelled' },
];

export default function DispatchQueue() {
  const [visits, setVisits] = useState<Visit[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [filter, setFilter] = useState('requested');

  const load = async (statusFilter: string) => {
    setLoading(true);
    setErr('');
    try {
      const r: any = await AdminFE.listVisits(statusFilter || undefined);
      setVisits(Array.isArray(r) ? r : r?.visits || []);
    } catch (e: any) {
      setErr(e.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(filter); }, [filter]);

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-ink">Dispatch queue</h1>
          <p className="text-sm text-ink3 mt-0.5">
            Assign FEs, lock category, set schedule. Starting a workflow kicks off SLA timers.
          </p>
        </div>
        <button onClick={() => load(filter)} className="btn-secondary text-sm">
          ⟳ Refresh
        </button>
      </div>

      <div className="flex gap-1 mb-5 border-b border-ink4">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.key || 'all'}
            onClick={() => setFilter(f.key)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition ${
              filter === f.key
                ? 'border-honey-500 text-honey-700'
                : 'border-transparent text-ink3 hover:text-ink'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-ink3 text-sm">Loading…</div>
      ) : err ? (
        <div className="text-red-600 text-sm">{err}</div>
      ) : visits.length === 0 ? (
        <div className="card text-center py-12 text-ink3">
          No visits in <span className="font-medium">{filter || 'any status'}</span>.
        </div>
      ) : (
        <div className="grid gap-3">
          {visits.map((v) => (
            <VisitRow key={v.id} v={v} />
          ))}
        </div>
      )}
    </div>
  );
}

function VisitRow({ v }: { v: Visit }) {
  const addr = v.address || {};
  const addrLine = [addr.locality, addr.city, addr.pincode].filter(Boolean).join(', ');

  const statusColor =
    v.status === 'requested' ? 'bg-yellow-100 text-yellow-800' :
    v.status === 'scheduled' ? 'bg-blue-100 text-blue-800' :
    v.status === 'in_progress' ? 'bg-indigo-100 text-indigo-800' :
    v.status === 'completed' ? 'bg-green-100 text-green-800' :
    v.status === 'cancelled' ? 'bg-red-100 text-red-800' :
    'bg-gray-100 text-gray-800';

  const requestedAt = new Date(v.requested_slot_start);
  const scheduledAt = v.scheduled_slot_start ? new Date(v.scheduled_slot_start) : null;

  return (
    <Link to={`/dispatch/${v.id}`} className="block card hover:shadow-md transition">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`pill ${statusColor}`}>{v.status}</span>
            {v.workflow_id && (
              <span className="pill bg-honey-50 text-honey-700" title={v.workflow_id}>
                ⚙ workflow
              </span>
            )}
            <span className="text-xs text-ink3">#{v.id.slice(0, 8)}</span>
          </div>
          <div className="font-semibold text-ink">
            {v.category_name || v.category_hint}
          </div>
          <div className="text-sm text-ink2 mt-0.5 truncate">
            {addrLine || '—'}
          </div>
          <div className="text-xs text-ink3 mt-2 flex gap-4">
            <span>
              Requested: {requestedAt.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
            </span>
            {scheduledAt && (
              <span>
                Scheduled: {scheduledAt.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
              </span>
            )}
            {v.fe_code && <span>FE: {v.fe_code}</span>}
          </div>
        </div>
        <div className="text-ink3 text-lg">›</div>
      </div>
    </Link>
  );
}
