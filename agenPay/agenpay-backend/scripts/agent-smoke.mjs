// One-command API smoke test for reviewers and coding agents.
//   node scripts/agent-smoke.mjs [baseUrl]      (default http://localhost:3001)
// Needs only a running backend + Postgres. Works with or without NEAR sponsor keys (.env.near); no browser, no real money.
// Exits 0 if every check passes, 1 otherwise. Owner-signed flows (fund vault, limits) need the browser key: see AGENTS.md.
const B = process.argv[2] || 'http://localhost:3001';
const email = `agent-${Date.now()}@example.com`;
const password = `Agent-${Math.random().toString(36).slice(2)}-pw`;
let failed = 0;
const call = async (method, path, { token, body } = {}) => {
  const r = await fetch(B + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, json };
};
const check = (name, ok, got) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  -> ${JSON.stringify(got).slice(0, 160)}`}`); };

let r = await call('GET', '/health');
check('health: database connected', r.status === 200 && r.json.services?.database === 'connected', r);

r = await call('POST', '/api/auth/register', { body: { email, password, name: 'Agent Smoke' } });
check('register new user', r.status === 200 || r.status === 201, r);
r = await call('POST', '/api/auth/login', { body: { email, password } });
const token = r.json.token;
check('login returns JWT', r.status === 200 && !!token, r);
r = await call('POST', '/api/auth/login', { body: { email, password: 'wrong-password' } });
check('wrong password rejected (401)', r.status === 401, r);
r = await call('POST', '/api/auth/register', { body: { email: 'x@example.com', password: 'short' } });
check('short password rejected (400)', r.status === 400, r);

for (const p of ['/api/me', '/api/invoices', '/api/payees', '/api/bills', '/api/near/status', '/api/vault/payments', '/api/export/invoices.csv', '/api/export/payments.csv', '/api/admin/users']) {
  r = await call('GET', p);
  check(`no token -> 401: ${p}`, r.status === 401, r);
}

r = await call('GET', '/api/near/status', { token });
check('near status: testnet, no company yet', r.status === 200 && typeof r.json.configured === 'boolean' && r.json.network === 'testnet' && r.json.company === null, r);
if (r.json?.configured === false) console.log('NOTE  NEAR sponsor not configured (no .env.near): fine for this smoke; company setup needs `npm run near:bootstrap`');
r = await call('GET', '/api/invoices', { token });
check('new user has zero invoices', r.status === 200 && Array.isArray(r.json.invoices) && r.json.invoices.length === 0, r);
r = await call('POST', '/api/vault/payments', { token, body: { payeeId: 'nope', amount: '1', idempotencyKey: 'k' } });
check('payment without company/payee is refused (4xx)', r.status >= 400 && r.status < 500, r);

r = await call('GET', '/x402/supported');
check('x402 facilitator advertises near-testnet', r.status === 200 && r.json.kinds?.[0]?.network === 'near-testnet', r);
r = await call('GET', '/x402pay/does-not-exist');
check('x402 unknown invoice is 404, not 500', r.status === 404, r);
r = await call('GET', '/api/public/invoices/does-not-exist');
check('public unknown invoice is 404', r.status === 404, r);
r = await call('GET', '/api/public/bill-inbox/zzzzzzzzzzzzzzzzzzzzzzzz');
check('bill inbox unknown token is 4xx', r.status >= 400 && r.status < 500, r);
r = await call('POST', '/api/public/invoices/does-not-exist/confirm', { body: { txHash: 'x', sender: 'y.testnet' } });
check('confirm on unknown invoice is 4xx', r.status >= 400 && r.status < 500, r);

console.log(failed ? `\n${failed} check(s) FAILED` : '\nALL CHECKS PASSED');
process.exit(failed ? 1 : 0);
