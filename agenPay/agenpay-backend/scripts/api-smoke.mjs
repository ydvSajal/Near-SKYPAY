// Full HTTP walkthrough against a running backend on NEAR testnet (acts as the owner's browser).
// Usage: node server.js  (other terminal)   then   node scripts/api-smoke.mjs
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { KeyPair, KeyPairSigner, Account, JsonRpcProvider, actions, encodeSignedDelegate } from 'near-api-js';

const here = path.dirname(fileURLToPath(import.meta.url));
config({ path: [path.join(here, '..', '.env.near'), path.join(here, '..', '.env')] });
const API = process.env.SMOKE_API || 'http://localhost:3001';
const RPC = process.env.NEAR_RPC_URL || 'https://test.rpc.fastnear.com';
const out = [];
const say = (...a) => { const l = a.join(' '); out.push(l); console.log(l); };
let token;
async function call(method, p, body, expectFail = false) {
  const r = await fetch(API + p, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let j; try { j = JSON.parse(text); } catch { j = text; }
  if (!r.ok && !expectFail) throw new Error(`${method} ${p} -> ${r.status} ${text.slice(0, 300)}`);
  return { status: r.status, body: j };
}
const TGAS = 1_000_000_000_000n;

say(`# SkyPay API smoke ${new Date().toISOString()} against ${API}`);
const email = `owner-${crypto.randomBytes(3).toString('hex')}@example.com`;
token = (await call('POST', '/api/auth/register', { email, password: 'Sm0ke-test-pass!', name: 'Acme Studio' })).body.token;
say('1. registered', email);

const ownerKp = KeyPair.fromRandom('ed25519'); // stays in the "browser"
const prov = (await call('POST', '/api/near/provision', { publicKey: ownerKp.getPublicKey().toString() })).body;
say('2. provisioned (no NEAR purchased by owner):', prov.company, '| vault', prov.vault, '| agent', prov.agent);

const inv = (await call('POST', '/api/invoices', {
  customerEmail: 'client@example.com', customerName: 'Client Co', description: 'Website design',
  lineItems: [{ description: 'Design sprint', quantity: 1, unitPrice: '7.50' }, { description: 'Hosting setup', quantity: 1, unitPrice: '2.50' }],
})).body.invoice;
say(`3. invoice ${inv.number} total ${inv.amountFormatted} USDC  checkout: /invoice/${inv.id}`);

const pub = (await call('GET', `/api/public/invoices/${inv.id}`)).body;
say(`4. public checkout shows: ${pub.amountFormatted} ${pub.asset} to ${pub.receiver} due ${pub.dueDate.slice(0, 10)} status=${pub.status}`);

const bogus = await call('POST', `/api/public/invoices/${inv.id}/confirm`, { txHash: '11111111111111111111111111111111111111111111', senderAccountId: 'x.testnet' }, true);
say(`5. fake tx hash rejected: ${bogus.status} ${bogus.body.error}`);

const paid = (await call('POST', `/api/public/invoices/${inv.id}/demo-pay`)).body;
say(`6. client paid (testnet demo payer, TEST token): status=${paid.status} ${paid.txUrl}`);
const again = (await call('POST', `/api/public/invoices/${inv.id}/confirm`, { txHash: paid.txHash, senderAccountId: paid.payer })).body;
say(`7. re-confirm same tx: status=${again.status} alreadyPaid=${again.alreadyPaid} (closes once)`);
const inv2 = (await call('POST', '/api/invoices', { customerEmail: 'other@example.com', lineItems: [{ description: 'x', quantity: 1, unitPrice: '10' }] })).body.invoice;
const reuse = await call('POST', `/api/public/invoices/${inv2.id}/confirm`, { txHash: paid.txHash, senderAccountId: paid.payer }, true);
say(`8. same tx used for another invoice: ${reuse.status} ${reuse.body.error}`);

// owner funds + policy via gasless delegate actions
const owner = new Account(prov.company, new JsonRpcProvider({ url: RPC }), KeyPairSigner.fromSecretKey(ownerKp.toString()));
async function relay(label, receiverId, method, args, deposit = 0n, gas = 30n * TGAS, expectFail = false) {
  const { signedDelegate } = await owner.createSignedMetaTransaction({ receiverId, actions: [actions.functionCall(method, args, gas, deposit)], blockHeightTtl: 120 });
  const r = await call('POST', '/api/near/relay', { signedDelegate: Buffer.from(encodeSignedDelegate(signedDelegate)).toString('base64'), label }, expectFail);
  return r;
}
const st0 = (await call('GET', '/api/near/status')).body;
say(`9. company received ${Number(st0.companyBalance) / 1e6} ${st0.tokenLabel}`);

const payeeKp = KeyPair.fromRandom('ed25519');
const payeeId = `skypay-sup-${crypto.randomBytes(3).toString('hex')}.testnet`;
// a supplier's own account (created here only so the demo has a real recipient)
const relayerAcct = new Account(process.env.NEAR_RELAYER_ACCOUNT, new JsonRpcProvider({ url: RPC }), KeyPairSigner.fromSecretKey(process.env.NEAR_RELAYER_KEY));
await relayerAcct.callFunctionRaw({ contractId: 'testnet', methodName: 'create_account', args: { new_account_id: payeeId, new_public_key: payeeKp.getPublicKey().toString() }, deposit: 5n * 10n ** 22n, gas: 100n * TGAS });
for (let i = 0; i < 10; i++) { const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'query', params: { request_type: 'view_account', finality: 'optimistic', account_id: payeeId } }) }); if (!(await r.json()).error) break; await new Promise((x) => setTimeout(x, 1000)); }
const payee = (await call('POST', '/api/payees', { name: 'Pixel Supplies', nearAccount: payeeId })).body.payee;
say(`10. owner registered payee ${payee.name} = ${payee.nearAccount}`);

let r = await relay('add_payee', st0.vault, 'add_payee', { payee: payeeId });
say(`11. allow-list payee on vault (sponsored): ${r.body.url}`);
r = await relay('set_agent', st0.vault, 'set_agent', { agent: st0.agent, per_tx_limit: '5000000', daily_limit: '8000000', expires_at_ms: Date.now() + 86_400_000 });
say(`12. agent limits 5 USDC/payment, 8 USDC/day (sponsored): ${r.body.url}`);
r = await relay('fund', st0.token, 'ft_transfer_call', { receiver_id: st0.vault, amount: '9000000', msg: 'fund' }, 1n, 100n * TGAS);
say(`13. owner funded vault 9 USDC (sponsored): ${r.body.url}`);
const bad = await relay('steal', st0.token, 'ft_transfer_call', { receiver_id: payeeId, amount: '1', msg: 'fund' }, 1n, 100n * TGAS, true);
say(`14. sponsor refuses non-vault transfer: ${bad.status} ${bad.body.error}`);

const p1 = await call('POST', '/api/vault/payments', { payeeId: payee.id, amount: '4', memo: 'INV-SUP-1', idempotencyKey: 'sup-1' }, true);
say(`15. agent pays supplier 4: ${p1.body.payment?.status} ${p1.body.payment?.url}`);
const p1r = await call('POST', '/api/vault/payments', { payeeId: payee.id, amount: '4', memo: 'INV-SUP-1', idempotencyKey: 'sup-1' }, true);
say(`16. same request repeated: ${p1r.body.payment?.status} same paymentId=${p1r.body.payment?.paymentId === p1.body.payment?.paymentId} (no second transfer)`);
const p2 = await call('POST', '/api/vault/payments', { payeeId: payee.id, amount: '6', memo: 'big', idempotencyKey: 'sup-2' }, true);
say(`17. 6 USDC (over 5 per-payment limit): ${p2.body.payment?.status} -> ${String(p2.body.payment?.error).slice(0, 90)}`);
const p3 = await call('POST', '/api/vault/payments', { payeeId: payee.id, amount: '4.5', memo: 'second', idempotencyKey: 'sup-3' }, true);
say(`18. 4.5 more (4+4.5 > 8 daily cap): ${p3.body.payment?.status} -> ${String(p3.body.payment?.error).slice(0, 90)}`);

const edited = (await call('PATCH', `/api/payees/${payee.id}`, { name: 'Pixel Supplies Ltd', notes: 'net 30' })).body.payee;
say(`18a. payee edited: ${edited.name} / ${edited.notes}`);
const bt = await call('POST', '/api/vault/payout-batches', { label: 'Smoke batch', items: [
  { payeeId: payee.id, amount: '1', memo: 'b1' }, { payeeId: payee.id, amount: '2', memo: 'b2' }, { payeeId: payee.id, amount: '2', memo: 'b3 (over daily cap)' }] }, true);
say(`18b. batch of 3 (1+2+2, daily cap leaves room for 4): batch=${bt.body.batch?.status} items=${bt.body.payments?.map((p) => p.status).join(',')}`);
const bl = (await call('GET', '/api/vault/payout-batches')).body.batches;
say(`18c. batch history lists ${bl.length} batch with ${bl[0]?.payments.length} payments`);
const overBatch = await call('POST', '/api/vault/payout-batches', { items: [{ payeeId: payee.id, amount: '999' }] }, true);
say(`18d. batch over vault balance refused: ${overBatch.status} ${overBatch.body.error}`);

const st = (await call('GET', '/api/near/status')).body;
say(`19. vault available ${Number(st.vaultAvailable) / 1e6}, reserved ${Number(st.vaultReserved) / 1e6}, agent spent today ${Number(st.agentPolicy?.spent_today) / 1e6}`);

const csvRes = await fetch(`${API}/api/export/invoices.csv`, { headers: { authorization: `Bearer ${token}` } });
const csv = await csvRes.text();
say('20. invoices.csv:\n' + csv.trim());
const pcsv = await (await fetch(`${API}/api/export/payments.csv`, { headers: { authorization: `Bearer ${token}` } })).text();
say('21. payments.csv:\n' + pcsv.trim());

token = (await call('POST', '/api/auth/register', { email: `intruder-${crypto.randomBytes(2).toString('hex')}@example.com`, password: 'Intrud3r-pass!', name: 'Intruder' })).body.token;
const leak = (await call('GET', '/api/invoices')).body.invoices.length;
say(`22. another company lists invoices: sees ${leak} (A17 tenant isolation)`);

fs.writeFileSync(path.join(here, '..', '..', '..', 'evidence', 'api-smoke-testnet.txt'), out.join('\n') + '\n');
say('\nsaved evidence/api-smoke-testnet.txt');
