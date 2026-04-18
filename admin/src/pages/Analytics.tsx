/**
 * Admin Analytics page — Sprint 4 / Pass 4g
 */
import React, { useEffect, useState } from 'react';
import { AdminAnalytics } from '../api';

interface SummaryItem {
  event_name: string;
  count: number;
  unique_actors: number;
  first_seen: string | null;
  last_seen: string | null;
}

export default function AnalyticsPage() {
  const [items, setItems] = useState<SummaryItem[]>([]);
  const [sinceDays, setSinceDays] = useState(7);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const r: any = await AdminAnalytics.summary(sinceDays);
      setItems(r.items || []);
      setError(null);
    } catch (e: any) {
      setError(e.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [sinceDays]);

  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ marginBottom: 8 }}>Analytics</h1>
      <p style={{ color: '#666', marginBottom: 24 }}>
        Event counts over the last {sinceDays} days.
      </p>

      <div style={{ marginBottom: 16, display: 'flex', gap: 12, alignItems: 'center' }}>
        <label>
          Window:{' '}
          <select
            value={sinceDays}
            onChange={(e) => setSinceDays(parseInt(e.target.value))}
            style={{ padding: 6 }}
          >
            <option value={1}>Last 24 hours</option>
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
        </label>
        <button onClick={load} style={{ padding: '6px 14px' }}>Refresh</button>
      </div>

      {loading && <p>Loading…</p>}
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      {!loading && items.length === 0 && (
        <p style={{ color: '#888' }}>No events in this window.</p>
      )}

      {items.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff' }}>
          <thead>
            <tr style={{ background: '#f4f4f4', textAlign: 'left' }}>
              <th style={{ padding: 10, borderBottom: '1px solid #ddd' }}>Event</th>
              <th style={{ padding: 10, borderBottom: '1px solid #ddd', textAlign: 'right' }}>Count</th>
              <th style={{ padding: 10, borderBottom: '1px solid #ddd', textAlign: 'right' }}>Unique users</th>
              <th style={{ padding: 10, borderBottom: '1px solid #ddd' }}>First</th>
              <th style={{ padding: 10, borderBottom: '1px solid #ddd' }}>Last</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.event_name}>
                <td style={{ padding: 10, borderBottom: '1px solid #eee' }}>
                  <code>{it.event_name}</code>
                </td>
                <td style={{ padding: 10, borderBottom: '1px solid #eee', textAlign: 'right', fontWeight: 600 }}>
                  {it.count.toLocaleString('en-IN')}
                </td>
                <td style={{ padding: 10, borderBottom: '1px solid #eee', textAlign: 'right' }}>
                  {it.unique_actors.toLocaleString('en-IN')}
                </td>
                <td style={{ padding: 10, borderBottom: '1px solid #eee', fontSize: 12, color: '#666' }}>
                  {it.first_seen ? new Date(it.first_seen).toLocaleString('en-IN') : '—'}
                </td>
                <td style={{ padding: 10, borderBottom: '1px solid #eee', fontSize: 12, color: '#666' }}>
                  {it.last_seen ? new Date(it.last_seen).toLocaleString('en-IN') : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
