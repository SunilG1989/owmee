import { useEffect, useState } from 'react';
import { AdminOpsControl } from '../api';

interface ProviderHealthItem {
  service: string;
  provider: string;
  status: string;
  missing: string[];
  launch_blocker: boolean;
  next_action?: string | null;
}

const statusClass: Record<string, string> = {
  ok: 'bg-green-50 text-green-800 border-green-200',
  warning: 'bg-yellow-50 text-yellow-900 border-yellow-200',
  blocked: 'bg-red-50 text-red-800 border-red-200',
};

export default function ProviderHealthPage() {
  const [items, setItems] = useState<ProviderHealthItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const r: any = await AdminOpsControl.providerHealth();
      setItems(Array.isArray(r) ? r : []);
    } catch (e: any) {
      setError(e.message || 'Failed to load provider health');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-ink">Provider health</h1>
          <p className="text-sm text-ink3 mt-0.5">
            Verifies the third-party setup needed for OTP, payments, AI, storage, KYC, push, and geocoding.
          </p>
        </div>
        <button onClick={load} className="btn-secondary text-sm">Refresh</button>
      </div>

      {loading ? (
        <div className="text-ink3 text-sm">Loading...</div>
      ) : error ? (
        <div className="text-red-600 text-sm">{error}</div>
      ) : (
        <div className="grid gap-3">
          {items.map((item) => (
            <div key={item.service} className={`card border ${statusClass[item.status] || 'border-ink4 bg-white'}`}>
              <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="font-semibold text-ink">{item.service}</h2>
                    {item.launch_blocker && (
                      <span className="pill bg-white/70 text-ink2">launch blocker</span>
                    )}
                  </div>
                  <div className="text-sm text-ink2 mt-1">Provider: {item.provider}</div>
                  {item.next_action && (
                    <div className="text-sm mt-2">{item.next_action}</div>
                  )}
                </div>
                <div className="md:text-right">
                  <span className={`pill ${statusClass[item.status] || 'bg-gray-100 text-gray-800'}`}>
                    {item.status}
                  </span>
                  <div className="text-xs mt-2 text-ink3">
                    {item.missing.length > 0
                      ? `Missing ${item.missing.join(', ')}`
                      : 'No missing config detected'}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
