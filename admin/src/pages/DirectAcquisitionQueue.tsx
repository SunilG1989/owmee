import { useEffect, useState } from 'react';
import { AdminFE, DirectOps } from '../api';

type ViewMode = 'dispatch' | 'price' | 'finance' | 'warehouse' | 'listing' | 'exceptions';

interface DirectItem {
  id: string;
  item_title: string;
  category: string;
  item_type: string;
  item_status: string;
  seller_photos?: string[];
  pickup_photos?: string[];
  owmee_suggested_offer_inr: number;
  fe_final_offer_inr: number | null;
  approval_required: boolean;
  approval_status: string;
  qc_status?: string;
  qc_notes?: string | null;
  custody_seal_code?: string | null;
  warehouse_status?: string;
  warehouse_notes?: string | null;
}

interface DirectBooking {
  id: string;
  booking_code: string;
  status: string;
  pickup_locality: string;
  pickup_pincode: string;
  slot_start: string;
  slot_end: string;
  assigned_fe_id: string | null;
  fe_code: string | null;
  item_count: number;
  estimated_total_offer_inr: number;
  final_total_payout_inr: number | null;
  payout_status?: string | null;
  payout_ready_at?: string | null;
  payout_reference_id?: string | null;
  payout_failure_reason?: string | null;
  warehouse_received_at?: string | null;
  warehouse_receipt_code?: string | null;
  risk_flags?: Array<string | Record<string, any>>;
  items: DirectItem[];
}

interface PriceApproval {
  id: string;
  booking_code: string | null;
  base_offer_inr: number;
  requested_offer_inr: number;
  change_percent: number;
  reason_code: string;
  status: string;
  item: DirectItem | null;
}

interface FE {
  id: string;
  fe_code: string;
  city: string;
}

const FILTERS = [
  { key: 'pending_fe_assignment', label: 'Needs assignment' },
  { key: 'assigned_to_fe', label: 'Assigned' },
  { key: 'pickup_qc_in_progress', label: 'QC in progress' },
  { key: 'payout_ready', label: 'Finance' },
  { key: 'payout_completed', label: 'Warehouse' },
  { key: 'warehouse_inbound', label: 'Warehouse' },
  { key: '', label: 'All' },
];

const VIEWS: Array<{ key: ViewMode; label: string }> = [
  { key: 'dispatch', label: 'Dispatch' },
  { key: 'price', label: 'Price approvals' },
  { key: 'finance', label: 'Finance payout' },
  { key: 'warehouse', label: 'Warehouse intake' },
  { key: 'exceptions', label: 'Exceptions' },
  { key: 'listing', label: 'Listing approvals' },
];

export default function DirectAcquisitionQueue() {
  const [view, setView] = useState<ViewMode>('dispatch');
  const [bookings, setBookings] = useState<DirectBooking[]>([]);
  const [priceApprovals, setPriceApprovals] = useState<PriceApproval[]>([]);
  const [listingItems, setListingItems] = useState<DirectItem[]>([]);
  const [fes, setFes] = useState<FE[]>([]);
  const [filter, setFilter] = useState('pending_fe_assignment');
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  const load = async () => {
    setLoading(true);
    setMessage('');
    try {
      if (view === 'dispatch') {
        const [bookingRes, feRes]: any[] = await Promise.all([
          DirectOps.listBookings(filter || undefined),
          AdminFE.listFEs(true),
        ]);
        setBookings(bookingRes?.bookings || []);
        setFes(feRes || []);
      } else if (view === 'price') {
        const res: any = await DirectOps.priceApprovals('pending');
        setPriceApprovals(res?.approvals || []);
      } else if (view === 'finance') {
        const res: any = await DirectOps.listBookings('payout_ready');
        setBookings(res?.bookings || []);
      } else if (view === 'warehouse') {
        const res: any = await DirectOps.listBookings('payout_completed');
        setBookings(res?.bookings || []);
      } else if (view === 'exceptions') {
        const res: any = await DirectOps.riskBookings();
        setBookings(res?.bookings || []);
      } else {
        const res: any = await DirectOps.listingApprovals('pending');
        setListingItems(res?.items || []);
      }
    } catch (e: any) {
      setMessage(e.message || 'Failed to load Direct operations');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [filter, view]);

  const assign = async (bookingId: string, feId: string) => {
    if (!feId) return;
    try {
      await DirectOps.assignFe(bookingId, feId);
      setMessage('FE assigned.');
      await load();
    } catch (e: any) {
      setMessage(e.message || 'Assignment failed');
    }
  };

  const decidePrice = async (approvalId: string, approve: boolean) => {
    try {
      if (approve) await DirectOps.approvePrice(approvalId, 'Approved from Direct ops console.');
      else await DirectOps.rejectPrice(approvalId, 'Rejected from Direct ops console.');
      setMessage(approve ? 'Price override approved.' : 'Price override rejected.');
      await load();
    } catch (e: any) {
      setMessage(e.message || 'Price approval action failed');
    }
  };

  const decideListing = async (itemId: string, action: 'approve' | 'send-back' | 'quarantine' | 'reject') => {
    try {
      if (action === 'approve') await DirectOps.approveListing(itemId, 'Approved from Direct ops console.');
      if (action === 'send-back') await DirectOps.sendBackListing(itemId, 'Needs warehouse rework.');
      if (action === 'quarantine') await DirectOps.quarantineListing(itemId, 'Quarantined for review.');
      if (action === 'reject') await DirectOps.rejectListing(itemId, 'Rejected from Direct ops console.');
      setMessage('Listing decision saved.');
      await load();
    } catch (e: any) {
      setMessage(e.message || 'Listing action failed');
    }
  };

  const processPayout = async (bookingId: string) => {
    try {
      await DirectOps.processPayout(bookingId);
      setMessage('Seller payout posted by Finance.');
      await load();
    } catch (e: any) {
      setMessage(e.message || 'Payout action failed');
    }
  };

  const failPayout = async (bookingId: string) => {
    try {
      await DirectOps.failPayout(bookingId, 'Finance marked payout failed from Direct ops console.');
      setMessage('Payout marked failed for review.');
      await load();
    } catch (e: any) {
      setMessage(e.message || 'Payout failure action failed');
    }
  };

  const retryPayout = async (bookingId: string) => {
    try {
      await DirectOps.retryPayout(bookingId);
      setMessage('Failed payout moved back to Finance queue.');
      await load();
    } catch (e: any) {
      setMessage(e.message || 'Payout retry failed');
    }
  };

  const receiveWarehouse = async (bookingId: string) => {
    try {
      await DirectOps.warehouseReceive(bookingId);
      setMessage('Warehouse receipt saved.');
      await load();
    } catch (e: any) {
      setMessage(e.message || 'Warehouse receive failed');
    }
  };

  const markWarehouseMismatch = async (bookingId: string) => {
    const reason = window.prompt('Warehouse mismatch reason');
    if (!reason?.trim()) return;
    try {
      await DirectOps.warehouseMismatch(bookingId, reason.trim());
      setMessage('Warehouse mismatch moved to Exceptions.');
      await load();
    } catch (e: any) {
      setMessage(e.message || 'Warehouse mismatch action failed');
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-ink">Owmee Direct operations</h1>
          <p className="text-sm text-ink3 mt-0.5">
            Controlled Toys/Books pickup flow: assignment, FE QC approvals, warehouse/admin gate.
          </p>
        </div>
        <button onClick={load} className="btn-secondary text-sm">Refresh</button>
      </div>

      <div className="flex gap-1 mb-5 border-b border-ink4">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            onClick={() => setView(v.key)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition ${
              view === v.key ? 'border-petrol-500 text-petrol-700' : 'border-transparent text-ink3 hover:text-ink'
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>

      {view === 'dispatch' && (
        <div className="flex gap-1 mb-5 border-b border-ink4">
          {FILTERS.map((f) => (
            <button
              key={f.key || 'all'}
              onClick={() => setFilter(f.key)}
              className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition ${
                filter === f.key ? 'border-petrol-500 text-petrol-700' : 'border-transparent text-ink3 hover:text-ink'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      {message && <div className="card mb-4 text-sm text-ink2">{message}</div>}

      {loading ? (
        <div className="text-ink3 text-sm">Loading...</div>
      ) : view === 'dispatch' ? (
        <DispatchList bookings={bookings} fes={fes} onAssign={assign} />
      ) : view === 'price' ? (
        <PriceApprovalList approvals={priceApprovals} onDecision={decidePrice} />
      ) : view === 'finance' ? (
        <FinancePayoutList bookings={bookings} onPost={processPayout} onFail={failPayout} />
      ) : view === 'warehouse' ? (
        <WarehouseReceiveList bookings={bookings} onReceive={receiveWarehouse} onMismatch={markWarehouseMismatch} />
      ) : view === 'exceptions' ? (
        <ExceptionList bookings={bookings} onRetryPayout={retryPayout} />
      ) : (
        <ListingApprovalList items={listingItems} onDecision={decideListing} />
      )}
    </div>
  );
}

function DispatchList({
  bookings,
  fes,
  onAssign,
}: {
  bookings: DirectBooking[];
  fes: FE[];
  onAssign: (bookingId: string, feId: string) => void;
}) {
  if (bookings.length === 0) {
    return <div className="card text-center py-12 text-ink3">No Direct bookings here.</div>;
  }
  return (
    <div className="grid gap-4">
      {bookings.map((booking) => (
        <BookingCard key={booking.id} booking={booking} fes={fes} onAssign={onAssign} />
      ))}
    </div>
  );
}

function PriceApprovalList({
  approvals,
  onDecision,
}: {
  approvals: PriceApproval[];
  onDecision: (approvalId: string, approve: boolean) => void;
}) {
  if (approvals.length === 0) {
    return <div className="card text-center py-12 text-ink3">No pending price approvals.</div>;
  }
  return (
    <div className="grid gap-4">
      {approvals.map((approval) => (
        <div key={approval.id} className="card">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="pill bg-yellow-50 text-yellow-800">{approval.status}</span>
                {approval.booking_code && <span className="font-mono text-xs text-ink3">{approval.booking_code}</span>}
              </div>
              <div className="mt-2 font-semibold text-ink">
                {approval.item?.item_title || 'Unknown item'}
              </div>
              <div className="text-sm text-ink3">
                Reason: {approval.reason_code} · Change: {approval.change_percent}%
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs text-ink3">Base to requested</div>
              <div className="text-xl font-bold text-petrol-700">
                ₹{approval.base_offer_inr} → ₹{approval.requested_offer_inr}
              </div>
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => onDecision(approval.id, false)}>Reject</button>
            <button className="btn-primary" onClick={() => onDecision(approval.id, true)}>Approve</button>
          </div>
        </div>
      ))}
    </div>
  );
}

function FinancePayoutList({
  bookings,
  onPost,
  onFail,
}: {
  bookings: DirectBooking[];
  onPost: (bookingId: string) => void;
  onFail: (bookingId: string) => void;
}) {
  if (bookings.length === 0) {
    return <div className="card text-center py-12 text-ink3">No payouts waiting for Finance.</div>;
  }
  return (
    <div className="grid gap-4">
      {bookings.map((booking) => (
        <div key={booking.id} className="card">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="pill bg-yellow-50 text-yellow-800">{booking.payout_status || booking.status}</span>
                <span className="font-mono text-xs text-ink3">{booking.booking_code}</span>
              </div>
              <div className="mt-2 font-semibold text-ink">
                {booking.pickup_locality} · {booking.pickup_pincode}
              </div>
              <div className="text-sm text-ink3">
                Requested {booking.payout_ready_at ? new Date(booking.payout_ready_at).toLocaleString() : 'just now'} · {booking.item_count} item{booking.item_count === 1 ? '' : 's'}
              </div>
              <div className="mt-3 grid gap-2">
                {booking.items.filter((item) => ['qc_passed', 'qc_revised'].includes(item.item_status)).map((item) => (
                  <div key={item.id} className="rounded-md border border-ink4 p-2 text-sm">
                    <span className="font-medium text-ink">{item.item_title}</span>
                    <span className="text-ink3"> · {item.item_status.replace(/_/g, ' ')}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs text-ink3">Final seller payout</div>
              <div className="text-2xl font-bold text-petrol-700">
                ₹{booking.final_total_payout_inr || 0}
              </div>
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => onFail(booking.id)}>Mark failed</button>
            <button className="btn-primary" onClick={() => onPost(booking.id)}>Post payout</button>
          </div>
        </div>
      ))}
    </div>
  );
}

function WarehouseReceiveList({
  bookings,
  onReceive,
  onMismatch,
}: {
  bookings: DirectBooking[];
  onReceive: (bookingId: string) => void;
  onMismatch: (bookingId: string) => void;
}) {
  if (bookings.length === 0) {
    return <div className="card text-center py-12 text-ink3">No paid pickups waiting for warehouse receipt.</div>;
  }
  return (
    <div className="grid gap-4">
      {bookings.map((booking) => (
        <div key={booking.id} className="card">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="pill bg-petrol-50 text-petrol-700">{booking.status.replace(/_/g, ' ')}</span>
                <span className="font-mono text-xs text-ink3">{booking.booking_code}</span>
              </div>
              <div className="mt-2 font-semibold text-ink">
                Receive custody package from FE
              </div>
              <div className="text-sm text-ink3">
                Payout ref {booking.payout_reference_id || 'not recorded'} · {booking.item_count} manifest item{booking.item_count === 1 ? '' : 's'}
              </div>
              <div className="mt-3 grid gap-2">
                {booking.items.filter((item) => ['qc_passed', 'qc_revised'].includes(item.item_status)).map((item) => (
                  <div key={item.id} className="rounded-md border border-ink4 p-2 text-sm">
                    <span className="font-medium text-ink">{item.item_title}</span>
                    <span className="text-ink3"> · pickup photos {(item.pickup_photos || []).length}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs text-ink3">Warehouse status</div>
              <div className="text-xl font-bold text-petrol-700">
                Pending receipt
              </div>
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => onMismatch(booking.id)}>Report mismatch</button>
            <button className="btn-primary" onClick={() => onReceive(booking.id)}>Receive inventory</button>
          </div>
        </div>
      ))}
    </div>
  );
}

function ExceptionList({
  bookings,
  onRetryPayout,
}: {
  bookings: DirectBooking[];
  onRetryPayout: (bookingId: string) => void;
}) {
  if (bookings.length === 0) {
    return <div className="card text-center py-12 text-ink3">No Direct exceptions right now.</div>;
  }
  return (
    <div className="grid gap-4">
      {bookings.map((booking) => {
        const flags = (booking.risk_flags || []).map((flag) => {
          if (typeof flag === 'string') return { code: flag, message: flag };
          return {
            code: String((flag as any).code || 'risk'),
            message: String((flag as any).message || (flag as any).code || 'Needs review'),
          };
        });
        return (
          <div key={booking.id} className="card border border-red-100">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="pill bg-red-50 text-red-700">{booking.status.replace(/_/g, ' ')}</span>
                  <span className="font-mono text-xs text-ink3">{booking.booking_code}</span>
                </div>
                <div className="mt-2 font-semibold text-ink">
                  {booking.pickup_locality} · {booking.pickup_pincode}
                </div>
                {booking.payout_failure_reason && (
                  <div className="text-sm text-red-700 mt-1">
                    Payout: {booking.payout_failure_reason}
                  </div>
                )}
                <div className="mt-3 grid gap-2">
                  {(flags.length ? flags : [{ code: 'status', message: 'Status requires Ops review.' }]).map((flag, index) => (
                    <div key={`${flag.code}-${index}`} className="rounded-md border border-ink4 bg-white p-2 text-sm">
                      <span className="font-medium text-ink">{flag.code}</span>
                      <span className="text-ink3"> · {flag.message}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs text-ink3">Final payout</div>
                <div className="text-2xl font-bold text-petrol-700">
                  ₹{booking.final_total_payout_inr || booking.estimated_total_offer_inr || 0}
                </div>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              {booking.status === 'payout_failed' && (
                <button className="btn-primary" onClick={() => onRetryPayout(booking.id)}>Retry payout</button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ListingApprovalList({
  items,
  onDecision,
}: {
  items: DirectItem[];
  onDecision: (itemId: string, action: 'approve' | 'send-back' | 'quarantine' | 'reject') => void;
}) {
  if (items.length === 0) {
    return <div className="card text-center py-12 text-ink3">No warehouse items waiting for listing approval.</div>;
  }
  return (
    <div className="grid gap-4">
      {items.map((item) => (
        <div key={item.id} className="card">
          <div className="flex items-start justify-between gap-4">
            <div>
              <span className="pill bg-petrol-50 text-petrol-700">{item.item_status.replace(/_/g, ' ')}</span>
              <div className="mt-2 font-semibold text-ink">{item.item_title}</div>
              <div className="text-sm text-ink3">
                {item.category} · {item.item_type} · QC {item.qc_status || 'pending'}
              </div>
              {item.qc_notes && <div className="text-sm text-ink2 mt-2">{item.qc_notes}</div>}
            </div>
            <div className="text-right">
              <div className="text-xs text-ink3">Payout</div>
              <div className="text-xl font-bold text-petrol-700">
                ₹{item.fe_final_offer_inr || item.owmee_suggested_offer_inr}
              </div>
              <div className="text-xs text-ink3 mt-1">
                Photos {(item.pickup_photos || []).length} pickup / {(item.seller_photos || []).length} seller
              </div>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <button className="btn-secondary" onClick={() => onDecision(item.id, 'send-back')}>Send back</button>
            <button className="btn-secondary" onClick={() => onDecision(item.id, 'quarantine')}>Quarantine</button>
            <button className="btn-secondary" onClick={() => onDecision(item.id, 'reject')}>Reject</button>
            <button className="btn-primary" onClick={() => onDecision(item.id, 'approve')}>Approve listing</button>
          </div>
        </div>
      ))}
    </div>
  );
}

function BookingCard({
  booking,
  fes,
  onAssign,
}: {
  booking: DirectBooking;
  fes: FE[];
  onAssign: (bookingId: string, feId: string) => void;
}) {
  const [selectedFeId, setSelectedFeId] = useState(booking.assigned_fe_id || '');
  const canAssign = booking.status === 'pending_fe_assignment' || booking.status === 'assigned_to_fe';

  return (
    <div className="card">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="pill bg-petrol-50 text-petrol-700">{booking.status.replace(/_/g, ' ')}</span>
            <span className="font-mono text-xs text-ink3">{booking.booking_code}</span>
          </div>
          <div className="mt-2 font-semibold text-ink">
            {booking.pickup_locality} · {booking.pickup_pincode}
          </div>
          <div className="text-sm text-ink3">
            {new Date(booking.slot_start).toLocaleString()} → {new Date(booking.slot_end).toLocaleTimeString()}
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs text-ink3">Estimated offer</div>
          <div className="text-xl font-bold text-petrol-700">₹{booking.final_total_payout_inr || booking.estimated_total_offer_inr}</div>
          {booking.fe_code && <div className="text-xs text-ink3 mt-1">FE {booking.fe_code}</div>}
        </div>
      </div>

      <div className="mt-4 grid gap-2">
        {booking.items.map((item) => (
          <div key={item.id} className="rounded-md border border-ink4 p-3 bg-white">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="font-medium text-ink">{item.item_title}</div>
                <div className="text-xs text-ink3">
                  {item.category} · {item.item_type} · {item.item_status.replace(/_/g, ' ')}
                </div>
              </div>
              <div className="text-sm font-semibold text-ink">
                ₹{item.fe_final_offer_inr || item.owmee_suggested_offer_inr}
              </div>
            </div>
            {item.approval_required && (
              <div className="mt-2 text-xs text-yellow-800">
                Price approval: {item.approval_status}
              </div>
            )}
          </div>
        ))}
      </div>

      {canAssign && (
        <div className="mt-4 flex items-end gap-3">
          <div className="flex-1">
            <label className="label">Assign FE</label>
            <select className="input" value={selectedFeId} onChange={(e) => setSelectedFeId(e.target.value)}>
              <option value="">Select FE</option>
              {fes.map((fe) => (
                <option key={fe.id} value={fe.id}>{fe.fe_code} · {fe.city}</option>
              ))}
            </select>
          </div>
          <button
            className="btn-primary"
            disabled={!selectedFeId}
            onClick={() => onAssign(booking.id, selectedFeId)}
          >
            Assign
          </button>
        </div>
      )}
    </div>
  );
}
