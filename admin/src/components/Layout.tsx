import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';

export default function Layout({ children }: { children: React.ReactNode }) {
  const { session, logout } = useAuth();
  const nav = useNavigate();

  const doLogout = () => {
    logout();
    nav('/login');
  };

  return (
    <div className="min-h-full flex flex-col">
      <header className="bg-white border-b border-ink4">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <div className="font-bold text-lg text-honey-700 tracking-tight">
              Owmee <span className="text-ink3 font-normal">OPS6</span>
            </div>
            <nav className="flex gap-1 flex-wrap">
              <Tab to="/dispatch">Dispatch</Tab>
              <Tab to="/fes">Field executives</Tab>
              <Tab to="/listings">FE-assisted listings</Tab>
              <Tab to="/stuck-workflows">Stuck workflows</Tab>
              <Tab to="/fe-earnings">FE earnings</Tab>
              <Tab to="/audit-log">Audit log</Tab>
              <Tab to="/analytics">Analytics</Tab>
            </nav>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className="text-sm font-medium text-ink">{session?.name}</div>
              <div className="text-xs text-ink3">{session?.admin_role}</div>
            </div>
            <button onClick={doLogout} className="btn-secondary text-sm py-1">
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="flex-1 bg-cream">
        <div className="max-w-7xl mx-auto px-6 py-6">
          {children}
        </div>
      </main>
    </div>
  );
}

function Tab({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `px-3 py-2 rounded-md text-sm font-medium transition ${
          isActive
            ? 'bg-honey-50 text-honey-700'
            : 'text-ink2 hover:bg-sand'
        }`
      }
    >
      {children}
    </NavLink>
  );
}
