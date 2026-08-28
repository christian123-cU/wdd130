import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const ROLE_LABEL = {
  staff: 'Staff-in-Charge',
  finance: 'Finance Officer',
  director: 'Director',
  trustee: 'Trustee',
  admin: 'System Admin'
};

export function Rail() {
  const { user, logout } = useAuth();
  const isApprover = ['finance', 'director', 'trustee', 'admin'].includes(user.role);

  return (
    <nav className="rail">
      <div className="rail-brand">ChallengeAid</div>
      <div className="rail-sub">Disbursement Tracker</div>

      <div className="rail-nav">
        <NavLink to="/" end className={({ isActive }) => `rail-link${isActive ? ' active' : ''}`}>
          Requests
        </NavLink>
        {(user.role === 'staff' || user.role === 'admin') && (
          <NavLink to="/new-request" className={({ isActive }) => `rail-link${isActive ? ' active' : ''}`}>
            New Request
          </NavLink>
        )}
        {isApprover && (
          <NavLink to="/dashboard" className={({ isActive }) => `rail-link${isActive ? ' active' : ''}`}>
            Dashboard
          </NavLink>
        )}
        {user.role === 'admin' && (
          <>
            <NavLink to="/admin/centres" className={({ isActive }) => `rail-link${isActive ? ' active' : ''}`}>
              Centres
            </NavLink>
            <NavLink to="/admin/budget-lines" className={({ isActive }) => `rail-link${isActive ? ' active' : ''}`}>
              Budget Lines
            </NavLink>
            <NavLink to="/admin/users" className={({ isActive }) => `rail-link${isActive ? ' active' : ''}`}>
              Users
            </NavLink>
          </>
        )}
      </div>

      <div className="rail-user">
        {user.name}
        <span className="rail-user-role">{ROLE_LABEL[user.role] || user.role}</span>
        <button className="rail-logout" onClick={logout}>Log out</button>
      </div>
    </nav>
  );
}
