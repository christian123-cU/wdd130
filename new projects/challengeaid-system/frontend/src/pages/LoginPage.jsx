import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--paper)'
      }}
    >
      <div style={{ width: 380 }}>
        <div style={{ textAlign: 'center', marginBottom: '1.75rem' }}>
          <div
            aria-hidden="true"
            style={{
              width: 68,
              height: 68,
              margin: '0 auto 1rem',
              borderRadius: '50%',
              border: '2.5px dashed var(--line-strong)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: 'var(--font-mono)',
              fontSize: '1.6rem',
              color: 'var(--line-strong)'
            }}
          >
            CA
          </div>
          <h1>ChallengeAid</h1>
          <p className="eyebrow" style={{ marginTop: '0.3rem' }}>Disbursement &amp; Reconciliation Tracker</p>
        </div>

        <form className="card" onSubmit={handleSubmit}>
          {error && <div className="error-banner">{error}</div>}

          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <button type="submit" className="primary" style={{ width: '100%' }} disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p style={{ textAlign: 'center', marginTop: '1.25rem', fontSize: '0.82rem', color: 'var(--ink-soft)' }}>
          Ask your System Admin for an account if you don't have one yet.
        </p>
      </div>
    </div>
  );
}
