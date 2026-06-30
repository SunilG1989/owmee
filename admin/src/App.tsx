import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './auth';
import Layout from './components/Layout';
import Login from './pages/Login';
import DispatchQueue from './pages/DispatchQueue';
import StuckWorkflowsPage from './pages/StuckWorkflows';
import FeEarningsPage from './pages/FeEarnings';
import VisitDetail from './pages/VisitDetail';
import FeList from './pages/FeList';
import FeAssistedListings from './pages/FeAssistedListings';
import AuditLogPage from './pages/AuditLog';
import AnalyticsPage from './pages/Analytics';
import DirectAcquisitionQueue from './pages/DirectAcquisitionQueue';
import ControlTower from './pages/ControlTower';
import ProviderHealthPage from './pages/ProviderHealth';
import AdminUsersPage from './pages/AdminUsers';

export default function App() {
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-ink3">
        Loading…
      </div>
    );
  }

  if (!session) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<ControlTower />} />
        <Route path="/provider-health" element={<ProviderHealthPage />} />
        <Route path="/admin-users" element={<AdminUsersPage />} />
        <Route path="/dispatch" element={<DispatchQueue />} />
        <Route path="/direct-acquisitions" element={<DirectAcquisitionQueue />} />
        <Route path="/dispatch/:visitId" element={<VisitDetail />} />
        <Route path="/fes" element={<FeList />} />
        <Route path="/listings" element={<FeAssistedListings />} />
        {/* Sprint 4 / Pass 4 Batch 1 + 2 */}
        <Route path="/stuck-workflows" element={<StuckWorkflowsPage />} />
        <Route path="/fe-earnings" element={<FeEarningsPage />} />
        <Route path="/audit-log" element={<AuditLogPage />} />
        <Route path="/analytics" element={<AnalyticsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
