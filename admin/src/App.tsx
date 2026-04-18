import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './auth';
import Layout from './components/Layout';
import Login from './pages/Login';
import DispatchQueue from './pages/DispatchQueue';
import VisitDetail from './pages/VisitDetail';
import FeList from './pages/FeList';
import FeAssistedListings from './pages/FeAssistedListings';

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
        <Route path="/" element={<Navigate to="/dispatch" replace />} />
        <Route path="/dispatch" element={<DispatchQueue />} />
        <Route path="/dispatch/:visitId" element={<VisitDetail />} />
        <Route path="/fes" element={<FeList />} />
        <Route path="/listings" element={<FeAssistedListings />} />
        <Route path="*" element={<Navigate to="/dispatch" replace />} />
      </Routes>
    </Layout>
  );
}
