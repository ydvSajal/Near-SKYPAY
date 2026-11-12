// End-to-end TESTNET proof of the vault lifecycle. Prints a transcript with explorer links.
// Run after `npm run near:bootstrap`:  node scripts/near-e2e.mjs
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { KeyPair, KeyPairSigner, Account, actions, encodeSignedDelegate } from 'near-api-js';
import { NearService } from '../lib/near/NearService.js';
import { parseUnits, formatUnits } from '../lib/near/units.js';

config({ path: [path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env.near'), path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env')] });
const near = new NearService(process.env);
const out = [];
const say = (...a) => { const l = a.join(' '); out.push(l); console.log(l); };
const TGAS = 1_000_000_000_000n;
const U = (s) => parseUnits(s);
const rand = () => crypto.randomBytes(3).toString('hex');

// "browser" side: the owner's key never leaves this process; backend only sees the signed delegate
const ownerKp = KeyPair.fromRandom('ed25519');
const slug = `demo-${rand()}`;
say(`# SkyPay testnet e2e  ${new Date().toISOString()}  token=${near.token} (TEST token, not real USDC)`);

const p = await near.provision({ slug, ownerPublicKey: ownerKp.getPublicKey().toString() });
say(`provisioned company=${p.company} vault=${p.vault} agent=${p.agent}`);
p.log.forEach((l) => say(`  sponsor: ${l.kind} ${l.detail}`));
const user = {
  id: 'e2e', nearAccountId: p.company, nearPublicKey: ownerKp.getPublicKey().toString(),
  vaultAccountId: p.vault, agentAccountId: p.agent, agentKeyEnc: p.agentKeyEnc,
};

const owner = new Account(p.company, near.provider, KeyPairSigner.fromSecretKey(ownerKp.toString()));
async function relayAs(receiverId, methodName, args, deposit = 0n, gas = 30n * TGAS) {
  const { signedDelegate } = await owner.createSignedMetaTransaction({
    receiverId, actions: [actions.functionCall(methodName, args, gas, deposit)], blockHeightTtl: 100,
  });
  const b64 = Buffer.from(encodeSignedDelegate(signedDelegate)).toString('base64');
  return near.relay({ signedDelegateB64: b64, user });
}
const tryRelay = async (label, fn) => {
  try { const r = await fn(); say(`  [${label}] relayed tx ${r.txHash}`); return r; }
  catch (e) { say(`  [${label}] REFUSED -> ${e.message}`); return null; }
};

// payee + funding of the company with TEST tokens (stands in for an invoice payment)
const payeeId = `skypay-pay-${rand()}.testnet`;
const payeeKp = KeyPair.fromRandom('ed25519');
await near.createNamedAccount(payeeId, payeeKp.getPublicKey().toString(), 5n * 10n ** 22n);
await near.registerOnToken(payeeId);
await near.relayer().callFunctionRaw({ contractId: near.token, methodName: 'mint', args: { account_id: p.company, amount: U('100') }, gas: 30n * TGAS });
say(`company balance: ${formatUnits(await near.ftBalance(p.company))} tUSDC`);

say('\n## owner policy via sponsored (gasless) delegate actions - owner holds 0 purchased NEAR');
let r = await relayAs(p.vault, 'add_payee', { payee: payeeId }); say(`add_payee ${payeeId}: ${near.explorerTx(r.txHash)}`);
r = await relayAs(p.vault, 'set_agent', { agent: p.agent, per_tx_limit: U('50'), daily_limit: U('80'), expires_at_ms: Date.now() + 86_400_000 });
say(`set_agent limits 50/tx 80/day: ${near.explorerTx(r.txHash)}`);
r = await relayAs(near.token, 'ft_transfer_call', { receiver_id: p.vault, amount: U('90'), msg: 'fund' }, 1n, 100n * TGAS);
say(`fund vault 90: ${near.explorerTx(r.txHash)}`);
say('vault state:', JSON.stringify(await near.vaultState(p.vault)));

say('\n## agent payments (restricted function-call key, zero deposit)');
const exp = Date.now() + 3_600_000;
const pay = async (id, amt) => {
  try {
    const x = await near.agentPay({ user, paymentId: id, recipient: payeeId, amount: U(amt), invoiceRef: 'INV-E2E', expiresAtMs: exp });
    const failed = x.status?.Failure;
    say(`  pay ${id} ${amt}: ${failed ? 'REFUSED ' + JSON.stringify(failed).slice(0, 160) : 'ok'}  ${near.explorerTx(x.txHash)}`);
    return x;
  } catch (e) { say(`  pay ${id} ${amt}: REFUSED -> ${String(e.message).slice(0, 160)}`); }
};
await pay('e2e-1', '30');
say('  payee balance:', formatUnits(await near.ftBalance(payeeId)));
await pay('e2e-1', '30'); // replay
say('  payee balance after replay:', formatUnits(await near.ftBalance(payeeId)), '(unchanged = no double spend)');
await pay('e2e-2', '60'); // over per-tx limit
await pay('e2e-3', '50'); // 30+50 = 80 ok
await pay('e2e-4', '1'); // over daily cap
say('  payment record e2e-1:', JSON.stringify(await near.vaultPayment(p.vault, 'e2e-1')));

say('\n## sponsor refuses abuse (A22)');
await tryRelay('transfer NEAR out', async () => {
  const { signedDelegate } = await owner.createSignedMetaTransaction({ receiverId: p.vault, actions: [actions.transfer(10n ** 24n)], blockHeightTtl: 100 });
  return near.relay({ signedDelegateB64: Buffer.from(encodeSignedDelegate(signedDelegate)).toString('base64'), user });
});
await tryRelay('call unlisted contract', () => relayAs(near.token, 'mint', { account_id: p.company, amount: '1' }));
await tryRelay('fund someone else', () => relayAs(near.token, 'ft_transfer_call', { receiver_id: payeeId, amount: '1', msg: 'fund' }, 1n));
await tryRelay('add full-access key', async () => {
  const { signedDelegate } = await owner.createSignedMetaTransaction({ receiverId: p.vault, actions: [actions.addFullAccessKey(KeyPair.fromRandom('ed25519').getPublicKey())], blockHeightTtl: 100 });
  return near.relay({ signedDelegateB64: Buffer.from(encodeSignedDelegate(signedDelegate)).toString('base64'), user });
});
await tryRelay('revoke agent (allowed)', () => relayAs(p.vault, 'revoke_agent', { agent: p.agent }));
await pay('e2e-5', '1'); // after revoke

say('\nfinal vault state:', JSON.stringify(await near.vaultState(p.vault)));
fs.mkdirSync('../../evidence', { recursive: true });
fs.writeFileSync(path.join('../../evidence', 'near-testnet-e2e.txt'), out.join('\n') + '\n');
say('\nsaved evidence/near-testnet-e2e.txt');
