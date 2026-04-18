/**
 * FE Earnings admin page — Sprint 4 / Pass 4c
 */
import React, { useEffect, useState } from 'react';
import { AdminFeEarnings } from '../api';

interface Aggregate {
  fe_id: string;
  fe_code: string;
  fe_name: string | null;
  month: string;
  visits_count: number;
  total_paise: number;
  total_rupees: number;
  by_outcome: Record<string, number>;
}

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function FeEarningsPage() {
  const [month, setMonth] = useState(currentMonth());
  const [items, setItems] = useState<Aggregate[]>([]);
  const [grandTotal, setGrandTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const r: any = await AdminFeEarnings.monthly(month);
      setItems(r.aggregates || []);
      setGrandTotal(r.grand_total_paise || 0);
      setError(null);
    } catch (e: any) {
      setError(e.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [month]);

  const fmtRupees = (paise: number) =>
    `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 0 })}`;

  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ marginBottom: 8 }}>FE Earnings</h1>
      <p style={{ color: '#666', marginBottom: 24 }}>
        Per-FE monthly earnings. Only completed visits with payout-eligible outcomes count.
      </p>

      <div style={{ marginBottom: 16, display: 'flex', gap: 12, alignItems: 'center' }}>
        <label style={{ fontSize: 14 }}>
          Month:{' '}
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            style={{ padding: 6, border: '1px solid #ddd', borderRadius: 4 }}
          />
        </label>
        <button onClick={load} style={{ padding: '6px 14px' }}>Refresh</button>
        <span style={{ marginLeft: 'auto', fontSize: 16 }}>
          Grand total: <strong>{fmtRupees(grandTotal)}</strong>
        </span>
      </div>

      {loading && <p>Loading…</p>}
      {error && <p style={{ color: 'crimson' }}>{error}</p>}

      {!loading && items.length === 0 && (
        <p style={{ color: '#888' }}>No earnings recorded for {month}.</p>
      )}

      {items.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff' }}>
          <thead>
            <tr style={{ background: '#f4f4f4', textAlign: 'left' }}>
              <th style={{ padding: 10, borderBottom: '1px solid #ddd' }}>FE Code</th>
              <th style={{ padding: 10, borderBottom: '1px solid #ddd', textAlign: 'right' }}>Visits</th>
              <th style={{ padding: 10, borderBottom: '1px solid #ddd', textAlign: 'right' }}>Listed</th>
              <th style={{ padding: 10, borderBottom: '1px solid #ddd', textAlign: 'right' }}>Rejected</th>
              <th style={{ padding: 10, borderBottom: '1px solid #ddd', textAlign: 'right' }}>Other</th>
              <th style={{ padding: 10, borderBottom: '1px solid #ddd', textAlign: 'right' }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {items.map((a) => {
              const listed = a.by_outcome.listed || 0;
              const rejected = a.by_outcome.rejected_item || 0;
              const other = a.visits_count - listed - rejected;
              return (
                <tr key={a.fe_id}>
                  <td style={{ padding: 10, borderBottom: '1px solid #eee' }}>
                    <code>{a.fe_code}</code>
                  </td>
                  <td style={{ padding: 10, borderBottom: '1px solid #eee', textAlign: 'right' }}>
                    {a.visits_count}
                  </td>
                  <td style={{ padding: 10, borderBottom: '1px solid #eee', textAlign: 'right' }}>
                    {listed}
                  </td>
                  <td style={{ padding: 10, borderBottom: '1px solid #eee', textAlign: 'right' }}>
                    {rejected}
                  </td>
                  <td style={{ padding: 10, borderBottom: '1px solid #eee', textAlign: 'right' }}>
                    {other}
                  </td>
                  <td style={{
                    padding: 10, borderBottom: '1px solid #eee',
                    textAlign: 'right', fontWeight: 600,
                  }}>
                    {fmtRupees(a.total_paise)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
