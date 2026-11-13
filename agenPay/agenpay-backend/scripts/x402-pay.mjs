// TESTNET x402 client: pays a SkyPay invoice through its pay link, the way an agent would.
//   node scripts/x402-pay.mjs <invoiceId | http://host/x402pay/<id>>
// 1. GET the pay link -> 402 + payment requirements
// 2. a fresh payer (funded by the sponsor, minted TEST tokens) signs ONE ft_transfer as a NEP-366 delegate
// 3. retry with X-PAYMENT -> SkyPay's facilitator relays it (payer pays no gas), settles from chain data -> 200
// Transcript is written to evidence/x402-testnet.txt.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { KeyPair, KeyPairSigner, Account, actions, encodeSignedDelegate } from 'near-api-js';
import { NearService } from '../lib/near/NearService.js';

const here = path.dirname(fileURLToPath(import.meta.url));
config({ path: [path.join(here, '..', '.env.near'), path.join(here, '..', '.env')] });
const arg = process.argv[2];
if (!arg) throw new Error('usage: node scripts/x402-pay.mjs <invoiceId | pay link URL>');
const url = arg.startsWith('http') ? arg : `http://localhost:${process.env.PORT || 3001}/x402pay/${arg}`;

const near = new NearService(process.env);
const TGAS = 1_000_000_000_000n;
const out = [];
const say = (...a) => { const l = a.join(' '); out.push(l); console.log(l); };
const fromB64 = (s) => JSON.parse(Buffer.from(s, 'base64').toString('utf8'));
say(`# SkyPay x402 on NEAR testnet  ${new Date().toISOString()}  token=${near.token} (TEST token, not real USDC)`);

// 1. challenge
const r1 = await fetch(url, { headers: { accept: 'application/json' } });
const c = await r1.json();
say(`GET ${url} -> ${r1.status} ${c.error || ''}`);
if (r1.status !== 402 || !c.accepts?.length) throw new Error(`expected 402 with accepts, got ${r1.status}`);
const req = c.accepts[0];
say(`  requirements: scheme=${req.scheme} network=${req.network} payTo=${req.payTo} asset=${req.asset} amount=${req.maxAmountRequired} (${req.extra.decimals} decimals)`);
if (req.asset !== near.token) throw new Error(`asset ${req.asset} is not the pinned token ${near.token}`);

// 2. payer: new account, 0.1 NEAR for storage only, TEST tokens from the open mint
const kp = KeyPair.fromRandom('ed25519');
const payerId = `skypay-payer-${crypto.randomBytes(3).toString('hex')}.testnet`;
await near.createNamedAccount(payerId, kp.getPublicKey().toString(), 10n ** 23n);
const mint = await near.relayer().callFunctionRaw({
  contractId: near.token, methodName: 'mint', args: { account_id: payerId, amount: req.maxAmountRequired }, gas: 30n * TGAS,
});
say(`payer ${payerId} created; minted ${req.maxAmountRequired} -> ${near.explorerTx(mint.transaction.hash)}`);

const payer = new Account(payerId, near.provider, KeyPairSigner.fromSecretKey(kp.toString()));
const { signedDelegate } = await payer.createSignedMetaTransaction({
  receiverId: req.asset,
  actions: [actions.functionCall('ft_transfer', { receiver_id: req.payTo, amount: req.maxAmountRequired, memo: req.extra.invoiceId }, 30n * TGAS, 1n)],
  blockHeightTtl: 100,
});
const header = Buffer.from(JSON.stringify({
  x402Version: 1, scheme: 'exact', network: req.network,
  payload: { signedDelegate: Buffer.from(encodeSignedDelegate(signedDelegate)).toString('base64') },
})).toString('base64');
say('payer signed one ft_transfer delegate (no gas, no NEAR spent by payer)');

// 3. pay
const r2 = await fetch(url, { headers: { accept: 'application/json', 'X-PAYMENT': header } });
const body = await r2.json();
say(`GET ${url} + X-PAYMENT -> ${r2.status}`);
say(`  body: ${JSON.stringify(body)}`);
if (r2.headers.get('x-payment-response')) say(`  X-PAYMENT-RESPONSE: ${JSON.stringify(fromB64(r2.headers.get('x-payment-response')))}`);
if (r2.status !== 200) throw new Error('payment was not accepted');

// 4. replay of the same header must not pay twice
const r3 = await fetch(url, { headers: { accept: 'application/json', 'X-PAYMENT': header } });
say(`replay same X-PAYMENT -> ${r3.status} alreadyPaid=${(await r3.json()).alreadyPaid === true}`);

const file = path.join(here, '..', '..', '..', 'evidence', 'x402-testnet.txt');
fs.writeFileSync(file, out.join('\n') + '\n');
console.log(`\ntranscript -> ${path.relative(process.cwd(), file)}`);
