// This test exercises assertStageIsUnlocked indirectly is not possible
// since it's not exported (by design — it's an internal guard). Instead
// we test the public contract via a lightweight fake of the DB client,
// which is enough to catch sequence-logic regressions without needing
// a real Postgres instance in CI.

jest.mock('../src/config/db', () => {
  const state = { requests: {}, approvals: [] };
  return {
    __state: state,
    withTransaction: async (cb) => cb({
      query: async (text, params) => {
        if (text.startsWith('SELECT * FROM payment_requests WHERE id = $1 FOR UPDATE')) {
          return { rows: [state.requests[params[0]]].filter(Boolean) };
        }
        if (text.startsWith('SELECT id FROM approvals WHERE request_id')) {
          const [requestId, approverId, stage] = params;
          return {
            rows: state.approvals.filter(
              (a) => a.request_id === requestId && a.approver_id === approverId && a.stage === stage
            )
          };
        }
        if (text.startsWith('INSERT INTO approvals')) {
          const [requestId, approverId, stage, decision, comments] = params;
          state.approvals.push({ request_id: requestId, approver_id: approverId, stage, decision, comments });
          return { rows: [] };
        }
        if (text.startsWith("SELECT COUNT(*)::int AS count FROM approvals")) {
          const [requestId] = params;
          const count = state.approvals.filter(
            (a) => a.request_id === requestId && a.stage === 'trustee' && a.decision === 'approved'
          ).length;
          return { rows: [{ count }] };
        }
        if (text.startsWith('UPDATE payment_requests')) {
          const [status, , requestId] = params;
          state.requests[requestId].status = status;
          return { rows: [] };
        }
        if (text.startsWith('INSERT INTO audit_log')) {
          return { rows: [] };
        }
        if (text.startsWith('SELECT approver_id, decision, comments, created_at FROM approvals')) {
          const [requestId] = params;
          return {
            rows: state.approvals
              .filter((a) => a.request_id === requestId && a.stage === 'trustee')
              .map((a) => ({ ...a, created_at: new Date() }))
          };
        }
        throw new Error(`Unmocked query: ${text}`);
      }
    })
  };
});

const { recordApprovalDecision } = require('../src/services/approvalService');
const db = require('../src/config/db');

function seedRequest(id, status = 'submitted') {
  db.__state.requests[id] = { id, status };
}

beforeEach(() => {
  db.__state.requests = {};
  db.__state.approvals = [];
});

test('director cannot approve before finance', async () => {
  seedRequest('req1', 'submitted');
  await expect(
    recordApprovalDecision({
      requestId: 'req1',
      approver: { id: 'u-director', role: 'director' },
      decision: 'approved'
    })
  ).rejects.toThrow(/Director cannot act before Finance/);
});

test('finance approval advances status to finance_approved', async () => {
  seedRequest('req1', 'submitted');
  const result = await recordApprovalDecision({
    requestId: 'req1',
    approver: { id: 'u-finance', role: 'finance' },
    decision: 'approved'
  });
  expect(result.status).toBe('finance_approved');
});

test('a trustee cannot approve twice on the same request', async () => {
  seedRequest('req1', 'director_approved');
  await recordApprovalDecision({
    requestId: 'req1',
    approver: { id: 'u-trustee-1', role: 'trustee' },
    decision: 'approved'
  });
  await expect(
    recordApprovalDecision({
      requestId: 'req1',
      approver: { id: 'u-trustee-1', role: 'trustee' },
      decision: 'approved'
    })
  ).rejects.toThrow(/already recorded a decision/);
});

test('request only reaches trustee_approved once all four trustees approve', async () => {
  seedRequest('req1', 'director_approved');
  let result;
  for (const t of ['t1', 't2', 't3', 't4']) {
    result = await recordApprovalDecision({
      requestId: 'req1',
      approver: { id: t, role: 'trustee' },
      decision: 'approved'
    });
  }
  expect(result.status).toBe('trustee_approved');
  expect(result.trusteeApprovalsSoFar).toBe(4);
});

test('a rejection at any stage short-circuits the workflow', async () => {
  seedRequest('req1', 'director_approved');
  const result = await recordApprovalDecision({
    requestId: 'req1',
    approver: { id: 't1', role: 'trustee' },
    decision: 'rejected',
    comments: 'Missing vendor quote'
  });
  expect(result.status).toBe('rejected');
});
