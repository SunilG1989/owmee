import { useEffect, useState } from 'react';
import { AdminListings } from '../api';

interface Item {
  listing_id: string;
  seller_id: string;
  title: string;
  price: string;
  condition: string;
  city: string;
  status: string;
  moderation_status: string;
  moderation_flag: string | null;
  image_urls: string[];
  listing_source: string;
  reviewed_by: string;
  fe_visit_id: string | null;
  is_kids_item: boolean;
  kids_safety_checklist: Record<string, boolean> | null;
  created_at: string;
}

const KIDS_KEYS: { key: string; label: string }[] = [
  { key: 'cleaned', label: 'Cleaned' },
  { key: 'no_small_parts', label: 'No small parts' },
  { key: 'no_loose_batteries', label: 'No loose batteries' },
  { key: 'no_sharp_edges', label: 'No sharp edges' },
  { key: 'original_packaging', label: 'Original packaging' },
  { key: 'working_condition', label: 'Working condition' },
  { key: 'no_recalled_model', label: 'Not a recalled model' },
  { key: 'age_label_correct', label: 'Age label correct' },
];

export default function FeAssistedListings() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [mode, setMode] = useState<'queue' | 'all'>('queue');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState('');

  const load = async () => {
    setLoading(true);
    setErr('');
    try {
      const r: any = mode === 'queue'
        ? await AdminListings.queue('fe_assisted')
        : await AdminListings.feAssisted();
      setItems(r?.items || []);
    } catch (e: any) {
      setErr(e.message || 'Failed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [mode]);

  const approve = async (id: string) => {
    setBusyId(id);
    setMsg('');
    try {
      const r: any = await AdminListings.approve(id);
      setMsg(`Approved · reviewed_by=${r.reviewed_by}`);
      await load();
    } catch (e: any) {
      setMsg(e.message || 'Approve failed');
    } finally {
      setBusyId(null);
    }
  };

  const reject = async (id: string) => {
    const flag = prompt('Rejection flag (required):', 'POOR_PHOTOS');
    if (!flag) return;
    const reason = prompt('Reason (optional):', '') || '';
    setBusyId(id);
    setMsg('');
    try {
      const r: any = await AdminListings.reject(id, flag, reason);
      setMsg(`Rejected · ${r.flag}`);
      await load();
    } catch (e: any) {
      setMsg(e.message || 'Reject failed');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-ink">FE-assisted listings</h1>
          <p className="text-sm text-ink3 mt-0.5">
            Listings captured on-site by a Field Executive. Approving stamps <code className="font-mono">reviewed_by='fe_and_ops'</code>.
          </p>
        </div>
        <div className="flex gap-1 bg-white rounded-md p-1 border border-ink4">
          <button
            onClick={() => setMode('queue')}
            className={`px-3 py-1 text-sm rounded ${mode === 'queue' ? 'bg-honey-500 text-white' : 'text-ink2'}`}
          >
            Review queue
          </button>
          <button
            onClick={() => setMode('all')}
            className={`px-3 py-1 text-sm rounded ${mode === 'all' ? 'bg-honey-500 text-white' : 'text-ink2'}`}
          >
            All FE-assisted
          </button>
        </div>
      </div>

      {msg && <div className="mb-4 text-sm bg-sand rounded p-3 text-ink2">{msg}</div>}

      {loading ? (
        <div className="text-ink3">Loading…</div>
      ) : err ? (
        <div className="text-red-600">{err}</div>
      ) : items.length === 0 ? (
        <div className="card text-center py-10 text-ink3">
          {mode === 'queue' ? 'No FE-assisted listings pending review.' : 'No FE-assisted listings yet.'}
        </div>
      ) : (
        <div className="grid gap-3">
          {items.map((i) => (
            <div key={i.listing_id} className="card">
              <div className="flex justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="pill bg-honey-50 text-honey-700">FE</span>
                    <span className="pill bg-gray-100 text-ink2 capitalize">{i.status}</span>
                    <span className="pill bg-sand text-ink2">reviewed: {i.reviewed_by}</span>
                    {i.is_kids_item && <span className="pill bg-blue-100 text-blue-800">kids</span>}
                  </div>
                  <div className="font-semibold text-ink">{i.title}</div>
                  <div className="text-sm text-ink2 mt-0.5">
                    ₹{i.price} · {i.condition} · {i.city}
                  </div>
                  <div className="text-xs text-ink3 mt-1">
                    ID: <span className="font-mono">{i.listing_id.slice(0, 8)}</span>
                    {i.fe_visit_id && (
                      <> · visit <span className="font-mono">{i.fe_visit_id.slice(0, 8)}</span></>
                    )}
                    · {new Date(i.created_at).toLocaleDateString()}
                  </div>

                  {i.is_kids_item && i.kids_safety_checklist && (
                    <div className="mt-3 bg-sand rounded-md p-3">
                      <div className="text-xs font-semibold text-ink2 mb-2">Kids safety checklist</div>
                      <div className="grid grid-cols-2 gap-1 text-xs">
                        {KIDS_KEYS.map(({ key, label }) => {
                          const checked = !!i.kids_safety_checklist?.[key];
                          return (
                            <div key={key} className={`flex items-center gap-1 ${checked ? 'text-green-700' : 'text-ink3'}`}>
                              <span>{checked ? '✓' : '○'}</span>
                              <span>{label}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex gap-2 shrink-0">
                  {i.status === 'pending_moderation' ? (
                    <>
                      <button
                        onClick={() => approve(i.listing_id)}
                        disabled={busyId === i.listing_id}
                        className="btn-primary text-sm"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => reject(i.listing_id)}
                        disabled={busyId === i.listing_id}
                        className="btn-danger text-sm"
                      >
                        Reject
                      </button>
                    </>
                  ) : (
                    <div className="text-xs text-ink3 self-center">No actions</div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
