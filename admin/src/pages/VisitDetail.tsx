import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { AdminFE, Listings } from '../api';

interface FE {
  id: string;
  fe_code: string;
  city: string;
  active: boolean;
  user_id: string;
}

interface Category {
  id: string;
  name: string;
  slug: string;
  shipping_eligible: boolean;
  local_eligible: boolean;
  imei_required: boolean;
}

interface Visit {
  id: string;
  status: string;
  fe_id: string | null;
  fe_code: string | null;
  category_id: string | null;
  category_name: string | null;
  category_slug: string | null;
  category_hint: string;
  item_notes: string | null;
  address: any;
  requested_slot_start: string;
  requested_slot_end: string;
  scheduled_slot_start: string | null;
  scheduled_slot_end: string | null;
  listing_id: string | null;
  workflow_id: string | null;
  outcome: string | null;
  outcome_reason: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

function toLocalInputValue(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  // datetime-local expects YYYY-MM-DDTHH:mm in local time
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toIsoFromLocal(local: string): string {
  if (!local) return '';
  return new Date(local).toISOString();
}

export default function VisitDetail() {
  const { visitId } = useParams<{ visitId: string }>();
  const nav = useNavigate();

  const [visit, setVisit] = useState<Visit | null>(null);
  const [fes, setFes] = useState<FE[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  // Form state
  const [selectedFeId, setSelectedFeId] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  const [slotStart, setSlotStart] = useState('');
  const [slotEnd, setSlotEnd] = useState('');

  const load = async () => {
    if (!visitId) return;
    setLoading(true);
    setErr('');
    try {
      const [v, fList, cats]: any[] = await Promise.all([
        AdminFE.getVisit(visitId),
        AdminFE.listFEs(true),
        Listings.categories(),
      ]);
      setVisit(v);
      setFes(fList || []);
      setCategories(cats?.categories || []);
      setSelectedFeId(v.fe_id || '');
      setSelectedCategoryId(v.category_id || '');
      setSlotStart(toLocalInputValue(v.scheduled_slot_start || v.requested_slot_start));
      setSlotEnd(toLocalInputValue(v.scheduled_slot_end || v.requested_slot_end));
    } catch (e: any) {
      setErr(e.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [visitId]);

  const canAssign = useMemo(() => {
    return (
      !!visit &&
      (visit.status === 'requested' || visit.status === 'postponed') &&
      !!selectedFeId &&
      !!selectedCategoryId &&
      !!slotStart &&
      !!slotEnd &&
      new Date(slotEnd) > new Date(slotStart)
    );
  }, [visit, selectedFeId, selectedCategoryId, slotStart, slotEnd]);

  const canReassign = useMemo(() => {
    return !!visit && visit.status === 'scheduled' && !!selectedFeId;
  }, [visit, selectedFeId]);

  const doAssign = async () => {
    if (!visit || !visitId || !canAssign) return;
    setSaving(true);
    setMsg('');
    try {
      await AdminFE.assign(
        visitId,
        selectedFeId,
        toIsoFromLocal(slotStart),
        toIsoFromLocal(slotEnd),
        selectedCategoryId,
      );
      setMsg('Assigned. Workflow started.');
      await load();
    } catch (e: any) {
      setMsg(e.message || 'Assign failed');
    } finally {
      setSaving(false);
    }
  };

  const doReassign = async () => {
    if (!visit || !visitId || !canReassign) return;
    setSaving(true);
    setMsg('');
    try {
      await AdminFE.reassign(
        visitId,
        selectedFeId,
        slotStart ? toIsoFromLocal(slotStart) : undefined,
        slotEnd ? toIsoFromLocal(slotEnd) : undefined,
        selectedCategoryId || undefined,
      );
      setMsg('Re-assigned.');
      await load();
    } catch (e: any) {
      setMsg(e.message || 'Reassign failed');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="text-ink3">Loading…</div>;
  if (err) return <div className="text-red-600">{err}</div>;
  if (!visit) return <div className="text-ink3">Not found</div>;

  const addr = visit.address || {};

  return (
    <div>
      <div className="mb-5">
        <button onClick={() => nav('/dispatch')} className="text-sm text-ink3 hover:text-ink">
          ← Back to dispatch
        </button>
      </div>

      <div className="flex items-start justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-ink">
            Visit <span className="font-mono text-lg text-ink3">{visit.id.slice(0, 8)}</span>
          </h1>
          <div className="flex items-center gap-2 mt-2">
            <span className="pill bg-gray-100 text-ink2 capitalize">{visit.status}</span>
            {visit.outcome && (
              <span className="pill bg-sand text-ink2">outcome: {visit.outcome}</span>
            )}
            {visit.workflow_id && (
              <span className="pill bg-honey-50 text-honey-700">
                ⚙ {visit.workflow_id}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="card">
          <div className="font-semibold text-ink mb-3">Visit info</div>
          <Field label="Category hint">{visit.category_hint}</Field>
          <Field label="Locked category">
            {visit.category_name ? (
              <span>{visit.category_name} <span className="text-ink3">({visit.category_slug})</span></span>
            ) : (
              <span className="text-ink3">— not yet locked</span>
            )}
          </Field>
          <Field label="Address">
            {[addr.house, addr.street, addr.locality, addr.city, addr.pincode].filter(Boolean).join(', ') || '—'}
          </Field>
          <Field label="Notes">{visit.item_notes || '—'}</Field>
          <Field label="Requested slot">
            {new Date(visit.requested_slot_start).toLocaleString()} →{' '}
            {new Date(visit.requested_slot_end).toLocaleString()}
          </Field>
          {visit.scheduled_slot_start && (
            <Field label="Scheduled slot">
              {new Date(visit.scheduled_slot_start).toLocaleString()} →{' '}
              {new Date(visit.scheduled_slot_end!).toLocaleString()}
            </Field>
          )}
          {visit.fe_code && <Field label="FE">{visit.fe_code}</Field>}
          {visit.listing_id && (
            <Field label="Listing">
              <Link to={`/listings`} className="text-honey-700 underline">
                {visit.listing_id.slice(0, 8)}…
              </Link>
            </Field>
          )}
        </div>

        <div className="card">
          <div className="font-semibold text-ink mb-3">
            {visit.status === 'scheduled' ? 'Re-assign' : 'Assign'}
          </div>

          <div className="space-y-3">
            <div>
              <label className="label">Field executive</label>
              <select
                className="input"
                value={selectedFeId}
                onChange={(e) => setSelectedFeId(e.target.value)}
                disabled={visit.status !== 'requested' && visit.status !== 'scheduled' && visit.status !== 'postponed'}
              >
                <option value="">— select FE —</option>
                {fes.map((fe) => (
                  <option key={fe.id} value={fe.id}>
                    {fe.fe_code} · {fe.city}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="label">Lock category</label>
              <select
                className="input"
                value={selectedCategoryId}
                onChange={(e) => setSelectedCategoryId(e.target.value)}
              >
                <option value="">— select category —</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.slug})
                  </option>
                ))}
              </select>
              <div className="text-xs text-ink3 mt-1">
                The FE capture screen will pre-select this category.
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Slot start</label>
                <input
                  type="datetime-local"
                  className="input"
                  value={slotStart}
                  onChange={(e) => setSlotStart(e.target.value)}
                />
              </div>
              <div>
                <label className="label">Slot end</label>
                <input
                  type="datetime-local"
                  className="input"
                  value={slotEnd}
                  onChange={(e) => setSlotEnd(e.target.value)}
                />
              </div>
            </div>

            {visit.status === 'requested' || visit.status === 'postponed' ? (
              <button
                onClick={doAssign}
                disabled={!canAssign || saving}
                className="btn-primary w-full"
              >
                {saving ? 'Assigning…' : 'Assign FE + start workflow'}
              </button>
            ) : visit.status === 'scheduled' ? (
              <button
                onClick={doReassign}
                disabled={!canReassign || saving}
                className="btn-secondary w-full"
              >
                {saving ? 'Re-assigning…' : 'Re-assign'}
              </button>
            ) : (
              <div className="text-xs text-ink3">
                This visit is {visit.status} — no assignment actions available.
              </div>
            )}

            {msg && <div className="text-sm text-ink2 bg-sand rounded-md p-2">{msg}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="py-1.5 border-b border-sand last:border-0">
      <div className="text-xs text-ink3 font-semibold">{label}</div>
      <div className="text-sm text-ink mt-0.5">{children}</div>
    </div>
  );
}
