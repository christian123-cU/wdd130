import { useEffect, useState } from 'react';
import { api } from '../api';

const ROLES = ['staff', 'finance', 'director', 'trustee', 'admin'];

export function UsersPage() {
  const [users, setUsers] = useState([]);
  const [centres, setCentres] = useState([]);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'staff', centreId: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  function load() {
    api.listUsers().then(setUsers).catch((err) => setError(err.message));
  }
  useEffect(() => {
    api.listCentres().then(setCentres).catch((err) => setError(err.message));
    load();
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.createUser({ ...form, centreId: form.centreId || undefined });
      setForm({ name: '', email: '', password: '', role: 'staff', centreId: '' });
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDeactivate(id) {
    setError(null);
    try {
      await api.deactivateUser(id);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div style={{ maxWidth: 680 }}>
      <div className="page-header"><h1>Users</h1></div>
      {error && <div className="error-banner">{error}</div>}

      {users.map((u) => (
        <div key={u.id} className="request-row">
          <div className="request-row-main">
            <div className="recipient">{u.name} {!u.is_active && <span style={{ color: 'var(--stamp-brick)' }}>(inactive)</span>}</div>
            <div className="meta">{u.email} · {u.role}</div>
          </div>
          {u.is_active && (
            <button className="stamp-brick" onClick={() => handleDeactivate(u.id)}>Deactivate</button>
          )}
        </div>
      ))}

      <div className="card" style={{ marginTop: '1.5rem' }}>
        <h3>Add a user</h3>
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="name">Name</label>
            <input id="name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
          </div>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} required />
          </div>
          <div className="field">
            <label htmlFor="password">Temporary password</label>
            <input id="password" type="text" minLength={8} value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} required />
          </div>
          <div className="field">
            <label htmlFor="role">Role</label>
            <select id="role" value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}>
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="centreId">Centre (optional)</label>
            <select id="centreId" value={form.centreId} onChange={(e) => setForm((f) => ({ ...f, centreId: e.target.value }))}>
              <option value="">No centre</option>
              {centres.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <button type="submit" className="primary" disabled={busy}>Add user</button>
        </form>
      </div>
    </div>
  );
}
