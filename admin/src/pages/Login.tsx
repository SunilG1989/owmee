import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { AdminAuth } from '../api';

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [showBootstrap, setShowBootstrap] = useState(false);
  const [bootName, setBootName] = useState('Super Admin');
  const [bootMsg, setBootMsg] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      await login(email, password);
      nav('/dispatch');
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setSubmitting(false);
    }
  };

  const bootstrap = async () => {
    if (!email || !password || !bootName) {
      setBootMsg('Fill email, password, and name.');
      return;
    }
    setBootMsg('');
    try {
      const r: any = await AdminAuth.bootstrap(email, password, bootName, 'SUPER_ADMIN');
      setBootMsg(
        r.created
          ? `Created super admin. Now sign in below.`
          : `Admin already exists (${r.role}). Sign in below.`,
      );
    } catch (err: any) {
      setBootMsg(err.message || 'Bootstrap failed');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-cream">
      <div className="w-full max-w-md card">
        <div className="text-center mb-6">
          <div className="text-2xl font-bold text-honey-700">Owmee OPS6</div>
          <div className="text-sm text-ink3 mt-1">Dispatch console</div>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="label">Email</label>
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input"
            />
          </div>
          <div>
            <label className="label">Password</label>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input"
            />
          </div>
          {error && <div className="text-red-600 text-sm">{error}</div>}
          <button type="submit" disabled={submitting} className="btn-primary w-full">
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <div className="mt-6 pt-4 border-t border-ink4">
          <button
            type="button"
            className="text-xs text-ink3 underline"
            onClick={() => setShowBootstrap((v) => !v)}
          >
            {showBootstrap ? 'Hide' : 'Dev: bootstrap super admin'}
          </button>
          {showBootstrap && (
            <div className="mt-3 space-y-3 bg-sand rounded-md p-3">
              <div className="text-xs text-ink3">
                Non-prod only. Uses the email + password above. Enter a display name:
              </div>
              <input
                value={bootName}
                onChange={(e) => setBootName(e.target.value)}
                className="input text-sm"
                placeholder="Display name"
              />
              <button type="button" onClick={bootstrap} className="btn-secondary w-full text-sm">
                Bootstrap
              </button>
              {bootMsg && <div className="text-xs text-ink2">{bootMsg}</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
