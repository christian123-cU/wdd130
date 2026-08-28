const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

function getToken() {
  return localStorage.getItem('ca_token');
}

async function request(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    // No JSON body (e.g. 204) — fine.
  }

  if (!res.ok) {
    const message = data?.error || `Request failed with status ${res.status}`;
    const err = new Error(message);
    err.status = res.status;
    err.details = data?.details;
    throw err;
  }

  return data;
}

export const api = {
  login: (email, password) => request('/auth/login', { method: 'POST', body: { email, password }, auth: false }),

  listCentres: () => request('/centres'),
  createCentre: (payload) => request('/centres', { method: 'POST', body: payload }),

  listBudgetLines: (centreId) => request(`/budget-lines${centreId ? `?centreId=${centreId}` : ''}`),
  createBudgetLine: (payload) => request('/budget-lines', { method: 'POST', body: payload }),

  listUsers: () => request('/users'),
  createUser: (payload) => request('/users', { method: 'POST', body: payload }),
  deactivateUser: (id) => request(`/users/${id}`, { method: 'DELETE' }),

  listRequests: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/payment-requests${qs ? `?${qs}` : ''}`);
  },
  getRequest: (id) => request(`/payment-requests/${id}`),
  createRequest: (payload) => request('/payment-requests', { method: 'POST', body: payload }),
  decide: (id, payload) => request(`/payment-requests/${id}/decision`, { method: 'POST', body: payload }),
  execute: (id, payload) => request(`/payment-requests/${id}/execute`, { method: 'POST', body: payload }),
  uploadDocument: (id, payload) => request(`/payment-requests/${id}/documents`, { method: 'POST', body: payload }),

  dashboardSummary: (centreId) => request(`/dashboard/summary${centreId ? `?centreId=${centreId}` : ''}`),
  dashboardAging: () => request('/dashboard/aging')
};

export { getToken, API_URL };
