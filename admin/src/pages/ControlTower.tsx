import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AdminOpsControl } from '../api';

interface QueueMetric {
  id: string;
  title: string;
  count: number;
  severity: 'ok' | 'warning' | 'critical' | string;
  owner_role: string;
  route: string;
  description: string;
}

interface ProviderHealthItem {
  service: string;
  provider: string;
  status: 'ok' | 'warning' | 'blocked' | string;
  missing: string[];
  launch_blocker: boolean;
  next_action?: string | null;
}

interface OpsSummary {
  generated_at: string;
  queues: QueueMetric[];
  provider_health: ProviderHealthItem[];
}

const severityClass: Record<string, string> = {
  ok: 'bg-green-50 text-green-800 border-green-200',
  warning: 'bg-yellow-50 text-yellow-900 border-yellow-200',
  critical: 'bg-red-50 text-red-800 border-red-200',
  blocked: 'bg-red-50 text-red-800 border-red-200',
};

export default function ControlTower() {
  const [summary, setSummary] = useState<OpsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const r: any = await AdminOpsControl.summary();
      setSummary(r);
    } catch (e: any) {
      setError(e.message || 'Failed to load control tower');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const blockers = summary?.provider_health.filter((p) => p.status === 'blocked') || [];
  const activeQueues = summary?.queues.filter((q) => q.count > 0) || [];
  const quietQueues = summary?.queues.filter((q) => q.count === 0) || [];

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-ink">Control tower</h1>
          <p className="text-sm text-ink3 mt-0.5">
            Launch-critical queues, provider readiness, and admin ownership in one place.
          </p>
        </div>
        <button onClick={load} className="btn-secondary text-sm">Refresh</button>
      </div>

      {loading ? (
        <div className="text-ink3 text-sm">Loading...</div>
      ) : error ? (
        <div className="text-red-600 text-sm">{error}</div>
      ) : summary ? (
        <div className="grid gap-5">
          <section className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Metric label="Active queues" value={activeQueues.length} tone={activeQueues.length ? 'warning' : 'ok'} />
            <Metric label="Provider blockers" value={blockers.length} tone={blockers.length ? 'critical' : 'ok'} />
            <Metric
              label="Last refreshed"
              value={new Date(summary.generated_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
              tone="ok"
            />
          </section>

          {blockers.length > 0 && (
            <section className="card border-red-200 bg-red-50">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="font-semibold text-red-900">Provider launch blockers</h2>
                  <p className="text-sm text-red-800 mt-1">
                    Resolve these before public traffic. Secrets are hidden; only missing keys are shown.
                  </p>
                </div>
                <Link to="/provider-health" className="btn-secondary text-sm bg-white">Open health</Link>
              </div>
              <div className="mt-3 grid gap-2">
                {blockers.map((p) => (
                  <div key={p.service} className="bg-white border border-red-200 rounded-md p-3">
                    <div className="flex items-center justify-between">
                      <div className="font-medium text-ink">{p.service}</div>
                      <span className="pill bg-red-100 text-red-800">{p.provider}</span>
                    </div>
                    <div className="text-xs text-red-800 mt-1">
                      Missing: {p.missing.join(', ') || 'provider mode is not launch-safe'}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-ink">Queues needing action</h2>
              <span className="text-xs text-ink3">{activeQueues.length} active</span>
            </div>
            {activeQueues.length === 0 ? (
              <div className="card text-sm text-ink3">No launch-critical queue is waiting right now.</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {activeQueues.map((q) => <QueueCard key={q.id} q={q} />)}
              </div>
            )}
          </section>

          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-ink">Quiet queues</h2>
              <span className="text-xs text-ink3">{quietQueues.length} clear</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {quietQueues.map((q) => <QueueCard key={q.id} q={q} compact />)}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string | number; tone: string }) {
  return (
    <div className={`card border ${severityClass[tone] || severityClass.ok}`}>
      <div className="text-xs font-medium uppercase opacity-70">{label}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
    </div>
  );
}

function QueueCard({ q, compact = false }: { q: QueueMetric; compact?: boolean }) {
  const cls = severityClass[q.severity] || 'bg-white text-ink border-ink4';
  return (
    <div className={`card border ${cls}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">{q.title}</div>
          {!compact && <div className="text-xs mt-1 opacity-80">{q.description}</div>}
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold leading-none">{q.count}</div>
          <div className="text-[11px] uppercase mt-1 opacity-70">{q.severity}</div>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="text-xs font-medium opacity-80">{q.owner_role}</span>
        {q.route.startsWith('/admin') ? (
          <a href={q.route} className="text-sm font-medium text-petrol-700 hover:underline">
            Open
          </a>
        ) : (
          <Link to={q.route} className="text-sm font-medium text-petrol-700 hover:underline">
            Open
          </Link>
        )}
      </div>
    </div>
  );
}
