import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Rail } from './components/Rail';
import { LoginPage } from './pages/LoginPage';
import { RequestsListPage } from './pages/RequestsListPage';
import { NewRequestPage } from './pages/NewRequestPage';
import { RequestDetailPage } from './pages/RequestDetailPage';
import { DashboardPage } from './pages/DashboardPage';
import { CentresPage } from './pages/CentresPage';
import { BudgetLinesPage } from './pages/BudgetLinesPage';
import { UsersPage } from './pages/UsersPage';

function Shell({ children }) {
  const { user } = useAuth();
  if (!user) return children;
  return (
    <div className="shell">
      <Rail />
      <main className="main">{children}</main>
    </div>
  );
}

function AppRoutes() {
  return (
    <Shell>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<ProtectedRoute><RequestsListPage /></ProtectedRoute>} />
        <Route path="/new-request" element={<ProtectedRoute roles={['staff', 'admin']}><NewRequestPage /></ProtectedRoute>} />
        <Route path="/requests/:id" element={<ProtectedRoute><RequestDetailPage /></ProtectedRoute>} />
        <Route path="/dashboard" element={<ProtectedRoute roles={['finance', 'director', 'trustee', 'admin']}><DashboardPage /></ProtectedRoute>} />
        <Route path="/admin/centres" element={<ProtectedRoute roles={['admin']}><CentresPage /></ProtectedRoute>} />
        <Route path="/admin/budget-lines" element={<ProtectedRoute roles={['admin']}><BudgetLinesPage /></ProtectedRoute>} />
        <Route path="/admin/users" element={<ProtectedRoute roles={['admin']}><UsersPage /></ProtectedRoute>} />
      </Routes>
    </Shell>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
