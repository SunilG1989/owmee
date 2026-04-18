import { useEffect, useState } from 'react';
import { AdminFE, Dev } from '../api';

interface FE {
  id: string;
  user_id: string;
  fe_code: string;
  city: string;
  active: boolean;
  current_shift: string;
  created_at: string;
}

export default function FeList() {
  const [fes, setFes] = useState<FE[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [activeOnly, setActiveOnly] = useState(true);

  // Dev helper — promote user by phone
  const [phone, setPhone] = useState('');
  const [city, setCity] = useState('Bengaluru');
  const [devMsg, setDevMsg] = useState('');
  const [devBusy, setDevBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    setErr('');
    try {
      const r: any = await AdminFE.listFEs(activeOnly);
      setFes(Array.isArray(r) ? r : r?.fes || []);
    } catch (e: any) {
      setErr(e.message || 'Failed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [activeOnly]);

  const promote = async () => {
    if (!phone) return;
    setDevBusy(true);
    setDevMsg('');
    try {
      const r: any = await Dev.makeFE(phone, city);
      setDevMsg(`Promoted ${r.phone} → ${r.fe_code}. They must log out + log back in on the mobile app to get the FE role claim.`);
      setPhone('');
      await load();
    } catch (e: any) {
      setDevMsg(e.message || 'Failed');
    } finally {
      setDevBusy(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-ink">Field executives</h1>
          <p className="text-sm text-ink3 mt-0.5">Active FEs across cities.</p>
        </div>
        <label className="flex items-center gap-2 text-sm text-ink2">
          <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} />
          Active only
        </label>
      </div>

      {/* Dev promote tool */}
      <div className="card mb-5 bg-honey-50 border-honey-300">
        <div className="text-sm font-semibold text-honey-700 mb-2">
          Dev: promote existing user to FE
        </div>
        <div className="text-xs text-ink3 mb-3">
          User must be OTP-verified on the mobile app first. Uses the dev-only
          <code className="font-mono mx-1">/v1/dev/make-fe</code> endpoint.
        </div>
        <div className="flex gap-2">
          <input
            className="input flex-1"
            placeholder="+919876543210"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <input
            className="input w-40"
            placeholder="City"
            value={city}
            onChange={(e) => setCity(e.target.value)}
          />
          <button className="btn-primary" onClick={promote} disabled={devBusy || !phone}>
            {devBusy ? 'Promoting…' : 'Promote'}
          </button>
        </div>
        {devMsg && <div className="text-sm text-ink2 mt-3 bg-white rounded p-2">{devMsg}</div>}
      </div>

      {loading ? (
        <div className="text-ink3">Loading…</div>
      ) : err ? (
        <div className="text-red-600">{err}</div>
      ) : fes.length === 0 ? (
        <div className="card text-center py-10 text-ink3">No FEs yet.</div>
      ) : (
        <div className="card p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-sand text-ink2">
              <tr>
                <Th>FE code</Th>
                <Th>City</Th>
                <Th>Shift</Th>
                <Th>Active</Th>
                <Th>Since</Th>
              </tr>
            </thead>
            <tbody>
              {fes.map((fe) => (
                <tr key={fe.id} className="border-t border-sand">
                  <Td><span className="font-mono font-medium">{fe.fe_code}</span></Td>
                  <Td>{fe.city}</Td>
                  <Td className="capitalize">{fe.current_shift}</Td>
                  <Td>
                    <span className={`pill ${fe.active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>
                      {fe.active ? 'active' : 'inactive'}
                    </span>
                  </Td>
                  <Td className="text-ink3">
                    {new Date(fe.created_at).toLocaleDateString()}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="text-left px-4 py-2 font-semibold text-xs uppercase tracking-wide">{children}</th>;
}
function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-3 ${className}`}>{children}</td>;
}
