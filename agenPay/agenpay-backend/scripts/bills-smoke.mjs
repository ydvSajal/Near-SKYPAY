// Supplier bill inbox, end to end over HTTP on NEAR testnet (acts as the owner's browser and a contractor).
// Provisions a FRESH company, so the vault runs the current near-artifacts/skypay_vault.wasm.
// Usage: node server.js  (other terminal)   then   node scripts/bills-smoke.mjs
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
const TGAS = 1_000_000_000_000n;
const out = [];
const say = (...a) => { const l = a.join(' '); out.push(l); console.log(l); };
let token;
async function call(method, p, body, expectFail = false, auth = true) {
  const r = await fetch(API + p, { method, headers: { 'content-type': 'application/json', ...(token && auth ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let j; try { j = JSON.parse(text); } catch { j = text; }
  if (!r.ok && !expectFail) throw new Error(`${method} ${p} -> ${r.status} ${text.slice(0, 300)}`);
  return { status: r.status, body: j };
}
const pub = (method, p, body, expectFail) => call(method, p, body, expectFail, false); // contractor: no login

say(`# SkyPay supplier bill inbox smoke ${new Date().toISOString()} against ${API} (NEAR testnet, tUSDC test token, no value)`);
const email = `agency-${crypto.randomBytes(3).toString('hex')}@example.com`;
token = (await call('POST', '/api/auth/register', { email, password: 'Sm0ke-test-pass!', name: 'Bill Smoke Agency' })).body.token;
const ownerKp = KeyPair.fromRandom('ed25519');
const prov = (await call('POST', '/api/near/provision', { publicKey: ownerKp.getPublicKey().toString() })).body;
say(`1. fresh company provisioned: ${prov.company} | vault ${prov.vault} | agent ${prov.agent}`);
const vaultCode = (await (await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'query', params: { request_type: 'view_account', finality: 'final', account_id: prov.vault } }) })).json()).result.code_hash;
say(`   vault code_hash (base58 sha256) ${vaultCode}`);

const owner = new Account(prov.company, new JsonRpcProvider({ url: RPC }), KeyPairSigner.fromSecretKey(ownerKp.toString()));
async function relay(label, receiverId, method, args, deposit = 0n, gas = 30n * TGAS) {
  const { signedDelegate } = await owner.createSignedMetaTransaction({ receiverId, actions: [actions.functionCall(method, args, gas, deposit)], blockHeightTtl: 120 });
  return call('POST', '/api/near/relay', { signedDelegate: Buffer.from(encodeSignedDelegate(signedDelegate)).toString('base64'), label });
}
await call('POST', '/api/near/test-faucet');
const st0 = (await call('GET', '/api/near/status')).body;
await relay('set_agent', st0.vault, 'set_agent', { agent: st0.agent, per_tx_limit: '5000000', daily_limit: '8000000', expires_at_ms: Date.now() + 86_400_000 });
await relay('fund', st0.token, 'ft_transfer_call', { receiver_id: st0.vault, amount: '20000000', msg: 'fund' }, 1n, 100n * TGAS);
say('2. faucet 100 tUSDC, agent limits 5/payment 8/day, vault funded 20 (all owner-signed, sponsor-relayed)');

// a contractor's own NEAR account (created here only so the demo has a real recipient)
const supplierId = `skypay-bill-${crypto.randomBytes(3).toString('hex')}.testnet`;
const relayerAcct = new Account(process.env.NEAR_RELAYER_ACCOUNT, new JsonRpcProvider({ url: RPC }), KeyPairSigner.fromSecretKey(process.env.NEAR_RELAYER_KEY));
await relayerAcct.callFunctionRaw({ contractId: 'testnet', methodName: 'create_account', args: { new_account_id: supplierId, new_public_key: KeyPair.fromRandom('ed25519').getPublicKey().toString() }, deposit: 5n * 10n ** 22n, gas: 100n * TGAS });
for (let i = 0; i < 15; i++) { const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'query', params: { request_type: 'view_account', finality: 'final', account_id: supplierId } }) }); if (!(await r.json()).error) break; await new Promise((x) => setTimeout(x, 1000)); }
await call('POST', '/api/payees', { name: 'Dana Design', email: 'dana@studio.example', nearAccount: supplierId });
await relay('add_payee', st0.vault, 'add_payee', { payee: supplierId });
say(`3. owner registered supplier Dana Design <dana@studio.example> = ${supplierId} and allow-listed it on the vault`);

const link = (await call('GET', '/api/bills/inbox-link')).body;
const inboxToken = link.token;
say(`4. inbox link: ${link.path}`);
const company = (await pub('GET', `/api/public/bill-inbox/${inboxToken}`)).body;
say(`5. contractor opens link (no login): "Send a bill to ${company.company}"`);

const b1 = (await pub('POST', `/api/public/bill-inbox/${inboxToken}`, { name: 'Dana', email: 'Dana@Studio.example', invoiceNumber: 'D-101', amount: '3', description: 'Logo work', payoutAccount: supplierId })).body;
say(`6. contractor submits D-101 for 3 tUSDC -> status link ${b1.statusPath}`);
const dup = await pub('POST', `/api/public/bill-inbox/${inboxToken}`, { name: 'Dana', email: 'dana@studio.example', invoiceNumber: 'D-101', amount: '3' }, true);
say(`7. same bill submitted again: ${dup.status} ${dup.body.error}`);
const b2 = (await pub('POST', `/api/public/bill-inbox/${inboxToken}`, { name: 'Dana', email: 'dana@studio.example', invoiceNumber: 'D-102', amount: '2', payoutAccount: 'attacker.testnet' })).body;
const b3 = (await pub('POST', `/api/public/bill-inbox/${inboxToken}`, { name: 'Mallory', email: 'mallory@evil.example', invoiceNumber: 'M-1', amount: '4', payoutAccount: 'mallory.testnet' })).body;
void b3;
let bills = (await call('GET', '/api/bills')).body.bills;
const find = (n) => bills.find((b) => b.invoiceNumber === n);
say(`8. owner inbox: ${bills.map((b) => `${b.invoiceNumber}=${b.status}${b.flags.length ? `[${b.flags.join(',')}]` : ''} -> ${b.payee?.nearAccount || 'no registered supplier'}`).join(' | ')}`);

const pay1 = (await call('POST', `/api/bills/${find('D-101').id}/pay`, {})).body;
say(`9. owner pays D-101: bill=${pay1.bill.status} payment=${pay1.payment.status} to ${pay1.payment.recipient} ${pay1.txUrl}`);
const again = (await call('POST', `/api/bills/${find('D-101').id}/pay`, {})).body;
say(`10. pay clicked again: alreadyDispatched=${again.alreadyDispatched}, same payment=${again.payment.id === pay1.payment.id} (no second transfer)`);
const noAck = await call('POST', `/api/bills/${find('D-102').id}/pay`, {}, true);
say(`11. D-102 (payout account changed on bill) without review: ${noAck.status} ${noAck.body.error}`);
const pay2 = (await call('POST', `/api/bills/${find('D-102').id}/pay`, { acknowledgeFlags: true })).body;
say(`12. D-102 after explicit review: paid to ${pay2.payment.recipient} (registered), not attacker.testnet: bill=${pay2.bill.status} ${pay2.txUrl}`);
const m1 = await call('POST', `/api/bills/${find('M-1').id}/pay`, { acknowledgeFlags: true }, true);
say(`13. M-1 from unregistered sender: ${m1.status} ${m1.body.error}`);
const rej = (await call('POST', `/api/bills/${find('M-1').id}/reject`, { note: 'Unknown sender' })).body.bill;
say(`14. owner rejects M-1: ${rej.status}`);

const s1 = (await pub('GET', b1.statusPath.replace('/bills/status/', '/api/public/bills/'))).body;
say(`15. contractor status page D-101: ${s1.status} ${s1.amountFormatted} tUSDC tx=${s1.txUrl}`);
const s2 = (await pub('GET', b2.statusPath.replace('/bills/status/', '/api/public/bills/'))).body;
say(`16. contractor status page D-102 shows no flags/registry data: keys=${Object.keys(s2).join(',')}`);

const pcsv = await (await fetch(`${API}/api/export/payments.csv`, { headers: { authorization: `Bearer ${token}` } })).text();
say('17. payments.csv (bills appear as vault payouts with their bill memo):\n' + pcsv.trim());

token = (await call('POST', '/api/auth/register', { email: `intruder-${crypto.randomBytes(2).toString('hex')}@example.com`, password: 'Intrud3r-pass!', name: 'Intruder' })).body.token;
const leak = (await call('GET', '/api/bills')).body.bills.length;
const steal = await call('POST', `/api/bills/${find('D-101').id}/pay`, {}, true);
say(`18. another company: sees ${leak} bills; paying this company's bill -> ${steal.status} ${steal.body.error}`);

fs.writeFileSync(path.join(here, '..', '..', '..', 'evidence', 'bills-smoke-testnet.txt'), out.join('\n') + '\n');
say('\nsaved evidence/bills-smoke-testnet.txt');
