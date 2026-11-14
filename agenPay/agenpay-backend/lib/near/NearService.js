// Native NEAR adapter: RPC reads, chain-verified settlement, account provisioning,
// sponsored (delegate) relay, and agent-signed vault payments.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Account, JsonRpcProvider, KeyPair, KeyPairSigner, actions, decodeSignedDelegate } from 'near-api-js';
import { normalizeDelegate, checkDelegate, checkPaymentDelegate, makeRateLimiter } from './relayGuard.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACTS = path.join(__dirname, '..', '..', 'near-artifacts');
const TGAS = 1_000_000_000_000n;
const NET = {
  testnet: { rpc: 'https://test.rpc.fastnear.com', helper: 'https://helper.testnet.near.org', suffix: 'testnet', explorer: 'https://testnet.nearblocks.io' },
};

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64');
// The public testnet RPC throttles bursts. Report that as a retryable 503 the UI can show, not a bare 500.
export const rpcBusy = () => Object.assign(new Error('NEAR network is busy (rate limited). Wait a few seconds and try again.'), { status: 503 });
export const isRpcBusy = (e) => /\b429\b|too many requests|rate.?limit|ECONNRESET|ETIMEDOUT|fetch failed|Unexpected token|not valid JSON/i.test(String(e?.message || e));

export class NearService {
  constructor(env = process.env) {
    this.network = env.NEAR_NETWORK || 'testnet';
    const n = NET[this.network];
    if (!n) throw new Error(`unsupported NEAR_NETWORK ${this.network} (testnet only; mainnet is out of scope)`);
    this.cfg = { ...n, rpc: env.NEAR_RPC_URL || n.rpc };
    this.token = env.NEAR_USDC_CONTRACT || null; // pinned NEP-141 contract
    this.decimals = 6;
    this.vaultCodeHash = env.NEAR_VAULT_CODE_HASH || null; // sha256 hex of the global vault wasm
    this.relayerId = env.NEAR_RELAYER_ACCOUNT || null;
    this.relayerKey = env.NEAR_RELAYER_KEY || null;
    this.encKey = crypto.createHash('sha256').update(env.NEAR_KEY_ENC_SECRET || env.JWT_SECRET || '').digest();
    this.provider = new JsonRpcProvider({ url: this.cfg.rpc });
    this.rateLimit = makeRateLimiter(30, 60_000);
    this.seenDelegates = new Set();
  }

  get configured() {
    return !!(this.token && this.relayerId && this.relayerKey);
  }
  explorerTx(hash) {
    return `${this.cfg.explorer}/txns/${hash}`;
  }
  explorerAccount(id) {
    return `${this.cfg.explorer}/address/${id}`;
  }

  // ------------------------------------------------------------------- reads
  async rpc(method, params) {
    for (let attempt = 0; ; attempt++) {
      const r = await fetch(this.cfg.rpc, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 'skypay', method, params }),
        signal: AbortSignal.timeout(15_000),
      });
      // A rate-limited or overloaded RPC often answers with a non-JSON page; treat that like a 429, not a crash.
      const j = await r.json().catch(() => null);
      // A 5xx that still carries a JSON-RPC error is a real answer (handled below), not throttling.
      const busy = r.status === 429 || !j || j.error?.code === -429 || (r.status >= 500 && !j.error);
      if (busy && attempt < 4) { await new Promise((x) => setTimeout(x, 1000 * (attempt + 1))); continue; }
      if (busy) throw rpcBusy();
      if (!r.ok && !j.error) throw new Error(`RPC HTTP ${r.status}`);
      if (j.error) throw Object.assign(new Error(j.error.data || j.error.message || 'rpc error'), { rpcError: j.error });
      return j.result;
    }
  }

  async view(contractId, method, args = {}) {
    const res = await this.rpc('query', {
      request_type: 'call_function', finality: 'final', account_id: contractId, method_name: method, args_base64: b64(args),
    });
    return JSON.parse(Buffer.from(res.result).toString('utf8'));
  }

  async blockHeight() {
    return (await this.rpc('block', { finality: 'final' })).header.height;
  }

  async accountExists(id) {
    try {
      await this.rpc('query', { request_type: 'view_account', finality: 'final', account_id: id });
      return true;
    } catch {
      return false;
    }
  }

  async ftBalance(accountId) {
    return this.view(this.token, 'ft_balance_of', { account_id: accountId });
  }
  vaultState(vault) {
    return this.view(vault, 'get_state');
  }
  vaultAgent(vault, agent) {
    return this.view(vault, 'get_agent', { agent });
  }
  vaultPayment(vault, paymentId) {
    return this.view(vault, 'get_payment', { payment_id: paymentId });
  }

  // ------------------------------------------------- settlement verification
  /**
   * Independently verify that `txHash` moved >= minAmount of the pinned token to `receiver`.
   * Trust model: reads final-state execution outcomes from the RPC node; does not trust the client or any callback.
   * Uses NEP-141 `ft_transfer` events emitted BY the pinned token contract in successful receipts.
   */
  async verifyTokenReceipt({ txHash, senderHint, receiver, minAmount, memos }) {
    const res = await this.rpc('tx', { tx_hash: txHash, sender_account_id: senderHint || receiver, wait_until: 'FINAL' });
    return NearService.evaluateReceipt(res, { token: this.token, receiver, minAmount, memos });
  }

  /** Pure: evaluate an RPC `tx` result. Exported for tests. */
  static evaluateReceipt(res, { token, receiver, minAmount, memos }) {
    // Binding: only transfers tagged with THIS invoice (its number or id) count, so one payment cannot close two invoices.
    if (!Array.isArray(memos) || !memos.length) return { ok: false, reason: 'invoice reference required' };
    if (!res?.status || !Object.hasOwn(res.status, 'SuccessValue')) return { ok: false, reason: 'transaction failed' };
    let received = 0n;
    let from = null;
    let otherMemo = 0n;
    // Money that left the receiver in the same transaction (ft_transfer_call refund via ft_resolve_transfer,
    // or a burn when the refund target is gone). The invoice counts only what the receiver kept.
    let outgoing = 0n;
    for (const ro of res.receipts_outcome || []) {
      const o = ro.outcome;
      if (o.executor_id !== token) continue;
      if (!o.status || !Object.hasOwn(o.status, 'SuccessValue')) return { ok: false, reason: 'token receipt not successful' };
      for (const line of o.logs || []) {
        if (!line.startsWith('EVENT_JSON:')) continue;
        let ev;
        try { ev = JSON.parse(line.slice(11)); } catch { continue; }
        if (ev.standard !== 'nep141') continue;
        for (const d of ev.data || []) {
          if (ev.event === 'ft_burn') { if (d.owner_id === receiver) outgoing += BigInt(d.amount); continue; }
          if (ev.event !== 'ft_transfer') continue;
          if (d.old_owner_id === receiver) { outgoing += BigInt(d.amount); continue; }
          if (d.new_owner_id !== receiver) continue;
          if (memos.includes(d.memo)) { received += BigInt(d.amount); from = d.old_owner_id; } else otherMemo += BigInt(d.amount);
        }
      }
    }
    if (received === 0n) return { ok: false, reason: otherMemo > 0n ? 'transfer is not tagged with this invoice (memo must be the invoice number)' : 'no matching token transfer to receiver' };
    if (outgoing > 0n) {
      // ponytail: any outflow from the receiver in the paying tx is treated as a refund of this payment; a payer can always resend cleanly.
      const kept = received > outgoing ? received - outgoing : 0n;
      if (kept === 0n) return { ok: false, reason: 'transfer was refunded to the payer' };
      received = kept;
    }
    if (received < BigInt(minAmount)) return { ok: false, reason: 'amount below invoice total', received: received.toString() };
    return { ok: true, received: received.toString(), from, blockHash: res.transaction_outcome?.block_hash };
  }

  // ------------------------------------------------------------- provisioning
  async helperCreate(newAccountId, publicKey) {
    const r = await fetch(`${this.cfg.helper}/account`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ newAccountId, newAccountPublicKey: publicKey }),
    });
    if (!r.ok && !(await this.accountExists(newAccountId))) throw new Error(`account creation failed: ${r.status}`);
    for (let i = 0; i < 15 && !(await this.accountExists(newAccountId)); i++) await new Promise((x) => setTimeout(x, 1000));
    if (!(await this.accountExists(newAccountId))) throw new Error(`account ${newAccountId} not visible on chain`);
  }

  /**
   * Testnet only: if the sponsor is below `min`, refill it from the network helper (throwaway account whose
   * whole balance is swept into the sponsor). Same mechanism as near:bootstrap. The helper rate-limits per IP;
   * we stop on its first refusal and never try to get around it.
   */
  async topUpSponsor(min = 3n * 10n ** 24n, maxRounds = 3) {
    if (this.cfg.suffix !== 'testnet') return 0;
    let rounds = 0;
    while (rounds < maxRounds && BigInt((await this.accountInfo(this.relayerId))?.amount ?? 0) < min) {
      const kp = KeyPair.fromRandom('ed25519');
      const funder = `skypay-fund-${crypto.randomBytes(4).toString('hex')}.testnet`;
      await this.helperCreate(funder, kp.getPublicKey().toString());
      await this.account(funder, kp.toString()).deleteAccount(this.relayerId);
      rounds++;
    }
    return rounds;
  }

  account(id, secret) {
    return new Account(id, this.provider, KeyPairSigner.fromSecretKey(secret));
  }
  relayer() {
    if (!this.configured) throw new Error('NEAR not configured: run `npm run near:bootstrap`');
    return this.account(this.relayerId, this.relayerKey);
  }

  /** Relayer registers an account on the token (NEP-145) so it can receive tokens. Sponsor-paid. */
  async registerOnToken(accountId) {
    const bal = await this.view(this.token, 'storage_balance_of', { account_id: accountId });
    if (bal) return null;
    const r = await this.relayer().callFunctionRaw({
      contractId: this.token, methodName: 'storage_deposit',
      args: { account_id: accountId, registration_only: true }, deposit: 20_000_000_000_000_000_000_000n, gas: 30n * TGAS,
    });
    return r.transaction.hash;
  }

  /**
   * Create the company's NEAR footprint. The owner key was generated in the browser; we never see its secret.
   * company  : owner's account (receives invoice payments)           key = owner's browser key
   * vault    : contract, owner = company, full-access key DELETED after deploy (immutable, no upgrade path)
   * agent    : may only call vault.pay via a restricted function-call key (gas allowance only)
   */
  /** Sponsor creates a top-level `<name>.testnet` account via the network's registrar contract and funds it. */
  async createNamedAccount(newAccountId, publicKey, amountYocto) {
    const res = await this.relayer().callFunctionRaw({
      contractId: this.cfg.suffix, methodName: 'create_account',
      args: { new_account_id: newAccountId, new_public_key: publicKey }, deposit: amountYocto, gas: 100n * TGAS,
    });
    for (let i = 0; i < 10 && !(await this.accountExists(newAccountId)); i++) await new Promise((x) => setTimeout(x, 1000));
    if (!(await this.accountExists(newAccountId))) throw new Error(`account ${newAccountId} was not created`);
    return res.transaction.hash;
  }

  /**
   * Public keys on an account. Fails closed: any RPC error other than "account does not exist" THROWS,
   * because callers decide custody (e.g. "the vault is keyless") from this answer.
   */
  async accessKeys(id) {
    let r;
    try {
      r = await this.rpc('query', { request_type: 'view_access_key_list', finality: 'final', account_id: id });
    } catch (e) {
      const why = JSON.stringify(e.rpcError || {}) + String(e.message);
      if (/UNKNOWN_ACCOUNT|does not exist/i.test(why)) return [];
      throw Object.assign(new Error(`could not read access keys of ${id}: ${e.message}`), { status: e.status }); // keeps a 503 "busy" visible
    }
    if (!Array.isArray(r?.keys)) throw new Error(`malformed access key list for ${id}`);
    return r.keys.map((k) => ({ publicKey: k.public_key, permission: k.access_key.permission }));
  }

  /** Final-finality reads lag a few blocks behind a just-sent deleteKey; poll until `ok(keys)` or ~12s, then return the last read so the caller's own check still fails closed. */
  async keysWhen(id, ok) {
    let keys = await this.accessKeys(id);
    for (let i = 0; i < 12 && !ok(keys); i++) { await new Promise((x) => setTimeout(x, 1000)); keys = await this.accessKeys(id); }
    return keys;
  }

  /** view_account: NEAR balance and storage usage, or null. */
  async accountInfo(id) {
    try {
      return await this.rpc('query', { request_type: 'view_account', finality: 'final', account_id: id });
    } catch {
      return null;
    }
  }

  /**
   * Resumable provisioning. Every secret is generated and persisted (encrypted, via `save`) BEFORE the account
   * that uses it is created, and every step first checks chain state, so a retry after a crash continues
   * the SAME accounts instead of creating a second set. `state` is the persisted progress (or null for a new setup).
   */
  async provision({ slug, ownerPublicKey, state = null, save = async () => {} }) {
    const sfx = this.cfg.suffix; // top-level names, created + funded by the sponsor (owner buys no NEAR)
    const company = `${slug}.${sfx}`;
    const vault = `${slug}-vault.${sfx}`;
    const agent = `${slug}-agent.${sfx}`;
    const NEAR = 10n ** 24n;
    const log = [];
    let s = state;
    if (!s) {
      for (const id of [company, vault, agent]) {
        if (id.length > 64) throw new Error('name too long');
        if (await this.accountExists(id)) throw new Error(`${id} already exists`);
      }
      s = {
        slug, ownerPublicKey,
        vaultKeyEnc: this.encrypt(KeyPair.fromRandom('ed25519').toString()),
        agentFullEnc: this.encrypt(KeyPair.fromRandom('ed25519').toString()),
        agentFcEnc: this.encrypt(KeyPair.fromRandom('ed25519').toString()),
      };
      await save(s);
    } else if (s.ownerPublicKey !== ownerPublicKey) {
      throw Object.assign(new Error('an interrupted setup exists for a different owner key; restore that key backup to resume'), { status: 409 });
    }
    const pub = (enc) => KeyPair.fromString(this.decrypt(enc)).getPublicKey().toString();
    const step = async (name, fn) => {
      if (s.done?.includes(name)) return;
      await fn();
      s = { ...s, done: [...(s.done || []), name] };
      await save(s);
    };

    // 1. company account carries the owner's browser-held key (we never see the secret)
    await step('company', async () => {
      if (await this.accountExists(company)) {
        const keys = await this.accessKeys(company);
        if (!keys.some((k) => k.publicKey === ownerPublicKey)) throw new Error(`${company} exists without the owner key`);
      } else await this.createNamedAccount(company, ownerPublicKey, NEAR / 5n);
      log.push({ kind: 'account_create', detail: company });
    });

    // 2. vault: deploy contract, init, register on token, then delete the only key (immutable)
    await step('vault', async () => {
      const vaultSecret = this.decrypt(s.vaultKeyEnc);
      const vaultPub = pub(s.vaultKeyEnc);
      const wasm = fs.readFileSync(path.join(ARTIFACTS, 'skypay_vault.wasm'));
      // storage staking: ~1 NEAR per 100 KB of code, plus headroom for payment records
      const vaultFunding = BigInt(wasm.length) * 10n ** 19n + (NEAR * 3n) / 10n; // 1e19 yocto per byte
      if (!(await this.accountExists(vault))) await this.createNamedAccount(vault, vaultPub, vaultFunding);
      const keys = await this.accessKeys(vault);
      const initialized = await this.vaultState(vault).then((x) => x?.owner === company, () => false);
      if (keys.some((k) => k.publicKey === vaultPub)) {
        const v = this.account(vault, vaultSecret);
        if (!initialized) {
          await v.deployContract(wasm);
          await v.callFunctionRaw({ contractId: vault, methodName: 'new', args: { owner: company, token: this.token }, gas: 30n * TGAS });
        }
        await this.registerOnToken(vault);
        await v.deleteKey(vaultPub); // no key left: code cannot change, funds only move via contract rules
      } else if (!initialized || keys.length) {
        throw new Error(`${vault} is in an unexpected state (keys=${keys.length}, initialized=${initialized}); not reusing it`);
      } else await this.registerOnToken(vault); // key already deleted before the crash: only finish registration
      // never mark the vault done unless the chain itself reports it keyless and initialized for this company
      const after = await this.keysWhen(vault, (k) => k.length === 0);
      if (after.length) throw new Error(`${vault} still has ${after.length} access key(s); setup stopped`);
      if (!(await this.vaultState(vault).then((x) => x?.owner === company, () => false))) throw new Error(`${vault} is not initialized for ${company}`);
      log.push({ kind: 'account_create', detail: `${vault} (vault contract deployed, all keys deleted)` });
    });

    // 3. agent account with a function-call-only key
    await step('agent', async () => {
      const fullPub = pub(s.agentFullEnc);
      const fcPub = pub(s.agentFcEnc);
      if (!(await this.accountExists(agent))) await this.createNamedAccount(agent, fullPub, NEAR / 5n);
      let keys = await this.accessKeys(agent);
      if (!keys.some((k) => k.publicKey === fcPub)) {
        if (!keys.some((k) => k.publicKey === fullPub)) throw new Error(`${agent} exists without SkyPay's keys; not reusing it`);
        await this.account(agent, this.decrypt(s.agentFullEnc)).addFunctionCallAccessKey({
          publicKey: fcPub, contractId: vault, methodNames: ['pay'], allowance: 150_000_000_000_000_000_000_000n,
        });
        keys = await this.accessKeys(agent);
      }
      if (keys.some((k) => k.publicKey === fullPub)) await this.account(agent, this.decrypt(s.agentFullEnc)).deleteKey(fullPub);
      const after = await this.keysWhen(agent, (k) => k.length === 1 && k[0].publicKey === fcPub);
      if (after.length !== 1 || after[0].publicKey !== fcPub || !after[0].permission?.FunctionCall) {
        throw new Error(`${agent} key state is not exactly one pay-only key; setup stopped`);
      }
      log.push({ kind: 'account_create', detail: `${agent} (function-call key: ${vault}.pay only)` });
    });

    // 4. receiving account must be registered on the token to receive invoice payments
    await step('register', async () => {
      await this.registerOnToken(company);
      log.push({ kind: 'storage_deposit', detail: `${company} registered on ${this.token}` });
    });

    return { company, vault, agent, agentKeyEnc: s.agentFcEnc, log };
  }

  encrypt(text) {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', this.encKey, iv);
    const ct = Buffer.concat([c.update(text, 'utf8'), c.final()]);
    return [iv, c.getAuthTag(), ct].map((b) => b.toString('base64')).join('.');
  }
  decrypt(blob) {
    const [iv, tag, ct] = blob.split('.').map((s) => Buffer.from(s, 'base64'));
    const d = crypto.createDecipheriv('aes-256-gcm', this.encKey, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
  }

  // --------------------------------------------------------------- sponsored relay
  /**
   * Validate and submit a user-signed delegate action. The relayer pays gas only; it holds no authority over user funds.
   * @returns {{txHash:string}}
   */
  async relay({ signedDelegateB64, user }) {
    if (!this.rateLimit(user.id)) throw Object.assign(new Error('rate limit: too many sponsored actions'), { status: 429 });
    let signed;
    try {
      signed = decodeSignedDelegate(Buffer.from(signedDelegateB64, 'base64'));
    } catch {
      throw Object.assign(new Error('malformed signed delegate'), { status: 400 });
    }
    const d = normalizeDelegate(signed.delegateAction);
    const verdict = checkDelegate(d, {
      userAccount: user.nearAccountId, userPublicKey: user.nearPublicKey, vault: user.vaultAccountId,
      token: this.token, currentBlockHeight: await this.blockHeight(),
    });
    if (!verdict.ok) throw Object.assign(new Error(`relay refused: ${verdict.reason}`), { status: 422 });

    const key = `${d.senderId}:${d.publicKey}:${d.maxBlockHeight}:${Buffer.from(signedDelegateB64, 'base64').subarray(-64).toString('hex')}`;
    if (this.seenDelegates.has(key)) throw Object.assign(new Error('relay refused: replayed delegate'), { status: 409 });
    this.seenDelegates.add(key);

    const res = await this.relayer().signAndSendTransaction({
      receiverId: d.senderId, actions: [actions.signedDelegate(signed)], waitUntil: 'EXECUTED_OPTIMISTIC', throwOnFailure: false,
    }).catch((e) => { throw isRpcBusy(e) ? rpcBusy() : e; });
    return { txHash: res.transaction.hash, status: res.status };
  }

  /** Decode + check a payer-signed ft_transfer delegate (x402 `exact` on NEAR). Throws status-tagged errors. */
  async checkPaymentDelegateB64(signedDelegateB64, { payTo, minAmount, memos }) {
    let signed;
    try {
      signed = decodeSignedDelegate(Buffer.from(String(signedDelegateB64), 'base64'));
    } catch {
      throw Object.assign(new Error('malformed signed delegate'), { status: 400 });
    }
    const d = normalizeDelegate(signed.delegateAction);
    const v = checkPaymentDelegate(d, { token: this.token, payTo, minAmount, memos, currentBlockHeight: await this.blockHeight() });
    if (!v.ok) throw Object.assign(new Error(`payment refused: ${v.reason}`), { status: 422 });
    return { signed, d };
  }

  /** Submit a payer's already-checked payment delegate. Sponsor pays gas only; replays are refused. */
  async relayPayment({ signed, d, signedDelegateB64, rateKey }) {
    if (!this.rateLimit(`pay:${rateKey}`)) throw Object.assign(new Error('rate limit: too many sponsored payments'), { status: 429 });
    const key = crypto.createHash('sha256').update(String(signedDelegateB64)).digest('hex'); // chain nonce also blocks replays
    if (this.seenDelegates.has(key)) throw Object.assign(new Error('payment refused: replayed delegate'), { status: 409 });
    this.seenDelegates.add(key);
    const res = await this.relayer().signAndSendTransaction({
      receiverId: d.senderId, actions: [actions.signedDelegate(signed)], waitUntil: 'EXECUTED_OPTIMISTIC', throwOnFailure: false,
    });
    return { txHash: res.transaction.hash, status: res.status, payer: d.senderId };
  }

  // ------------------------------------------------------------ agent payments
  /** Agent pays via the restricted key. Caller must have persisted the attempt BEFORE calling. */
  async agentPay({ user, paymentId, recipient, amount, invoiceRef, expiresAtMs }) {
    const agent = this.account(user.agentAccountId, this.decrypt(user.agentKeyEnc));
    const res = await agent.callFunctionRaw({
      contractId: user.vaultAccountId, methodName: 'pay',
      args: { payment_id: paymentId, recipient, amount, invoice_ref: invoiceRef, expires_at_ms: expiresAtMs },
      gas: 100n * TGAS, deposit: 0n, waitUntil: 'FINAL',
    });
    return { txHash: res.transaction.hash, status: res.status };
  }
}

export default NearService;
