// Sponsored-transaction guard (acceptance A21/A22).
// The relayer pays gas for a user's signed delegate action ONLY if every check passes.
// Pure functions: no network, easy to test. The chain still verifies signature + nonce.

const MAX_GAS = 300_000_000_000_000n; // 300 Tgas
const ONE_YOCTO = 1n;
const U128_MAX = (1n << 128n) - 1n;
const amount = (v) => typeof v === 'string' && /^[1-9]\d{0,38}$/.test(v) && BigInt(v) <= U128_MAX;
const account = (v) => typeof v === 'string' && /^(?=.{2,64}$)([a-z0-9]+[-_])*[a-z0-9]+(\.([a-z0-9]+[-_])*[a-z0-9]+)*$/.test(v);

function ownerArgs(method, args) {
  const fields = {
    set_agent: ['agent', 'per_tx_limit', 'daily_limit', 'expires_at_ms'],
    revoke_agent: ['agent'], add_payee: ['payee'], remove_payee: ['payee'], withdraw: ['amount'],
  }[method];
  if (!fields || Object.keys(args).some(k => !fields.includes(k)) || fields.some(k => !(k in args))) return false;
  if ('agent' in args && !account(args.agent)) return false;
  if ('payee' in args && !account(args.payee)) return false;
  if ('amount' in args && !amount(args.amount)) return false;
  if (method === 'set_agent') return amount(args.per_tx_limit) && amount(args.daily_limit) &&
    BigInt(args.per_tx_limit) <= BigInt(args.daily_limit) && Number.isSafeInteger(args.expires_at_ms) && args.expires_at_ms > 0;
  return true;
}


const VAULT_OWNER_METHODS = new Set(['set_agent', 'revoke_agent', 'add_payee', 'remove_payee', 'withdraw']);

/**
 * Turn a near-api-js DelegateAction into plain data.
 * Any non-FunctionCall action (transfer, deploy, add/delete key, stake...) becomes {kind:'other'} and is refused.
 */
export function normalizeDelegate(da) {
  return {
    senderId: da.senderId,
    receiverId: da.receiverId,
    publicKey: da.publicKey?.toString?.() ?? String(da.publicKey),
    maxBlockHeight: BigInt(da.maxBlockHeight),
    actions: da.actions.map((a) => {
      const fc = a.functionCall;
      if (!fc) return { kind: 'other' };
      let args = null;
      try {
        args = JSON.parse(Buffer.from(fc.args).toString('utf8'));
      } catch {
        args = null;
      }
      return { kind: 'functionCall', methodName: fc.methodName, args, gas: BigInt(fc.gas), deposit: BigInt(fc.deposit) };
    }),
  };
}

/**
 * @param d     normalized delegate (see normalizeDelegate)
 * @param ctx   { userAccount, userPublicKey, vault, token, currentBlockHeight }
 * @returns {ok:true} | {ok:false, reason}
 */
export function checkDelegate(d, ctx) {
  const fail = (reason) => ({ ok: false, reason });
  if (!ctx.userAccount || !ctx.vault) return fail('account not provisioned');
  if (d.senderId !== ctx.userAccount) return fail('sender is not the authenticated company account');
  if (ctx.userPublicKey && d.publicKey !== ctx.userPublicKey) return fail('signing key is not the registered owner key');
  if (d.maxBlockHeight <= BigInt(ctx.currentBlockHeight)) return fail('delegate action expired');
  if (d.maxBlockHeight - BigInt(ctx.currentBlockHeight) > 2000n) return fail('expiry too far in the future');
  if (d.receiverId !== ctx.vault && d.receiverId !== ctx.token) return fail('receiver is not an approved SkyPay contract');
  if (d.actions.length !== 1) return fail('exactly one action per relayed transaction');

  const a = d.actions[0];
  if (a.kind !== 'functionCall') return fail('only function calls can be sponsored');
  if (a.gas <= 0n || a.gas > MAX_GAS) return fail('gas above sponsor cap');
  if (!a.args || typeof a.args !== 'object' || Array.isArray(a.args) || JSON.stringify(a.args).length > 4096) return fail('arguments must be a bounded JSON object');

  if (d.receiverId === ctx.vault) {
    if (!VAULT_OWNER_METHODS.has(a.methodName)) return fail(`vault method not sponsored: ${a.methodName}`);
    if (a.deposit !== 0n) return fail('vault calls must attach no deposit');
    if (!ownerArgs(a.methodName, a.args)) return fail('invalid vault method arguments');
    return { ok: true };
  }

  // token contract: only "fund my own vault" via ft_transfer_call
  if (a.methodName !== 'ft_transfer_call') return fail(`token method not sponsored: ${a.methodName}`);
  if (a.deposit !== ONE_YOCTO) return fail('ft_transfer_call requires exactly 1 yoctoNEAR');
  if (a.args.receiver_id !== ctx.vault) return fail('funds may only be sent to the company vault');
  if (a.args.msg !== 'fund') return fail('unsupported transfer message');
  if (!amount(a.args.amount)) return fail('invalid amount');
  return { ok: true };
}

/** Per-company sliding-window rate limit (in-memory; single process). */
export function makeRateLimiter(max, windowMs) {
  const hits = new Map();
  return (key, now = Date.now()) => {
    const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (arr.length >= max) return false;
    arr.push(now);
    hits.set(key, arr);
    return true;
  };
}

/**
 * x402 payment delegate: the PAYER signs one NEP-141 `ft_transfer` of the pinned token to the merchant; the sponsor
 * only submits it (pays gas). Same style as checkDelegate: pure, no network.
 * @param ctx { token, payTo, minAmount, currentBlockHeight }
 */
export function checkPaymentDelegate(d, ctx) {
  const fail = (reason) => ({ ok: false, reason });
  if (d.receiverId !== ctx.token) return fail('payment must be a transfer of the invoice token');
  if (d.actions.length !== 1) return fail('exactly one action per payment');
  const a = d.actions[0];
  if (a.kind !== 'functionCall') return fail('only function calls can be sponsored');
  if (a.methodName !== 'ft_transfer') return fail(`token method not sponsored for payments: ${a.methodName}`);
  if (a.deposit !== ONE_YOCTO) return fail('ft_transfer requires exactly 1 yoctoNEAR');
  if (a.gas <= 0n || a.gas > MAX_GAS) return fail('gas above sponsor cap');
  if (!a.args || typeof a.args !== 'object' || Array.isArray(a.args) || JSON.stringify(a.args).length > 4096) return fail('arguments must be a bounded JSON object');
  if (a.args.receiver_id !== ctx.payTo) return fail('transfer must go to the invoice receiver');
  if (!amount(a.args.amount)) return fail('invalid amount');
  if (BigInt(a.args.amount) < BigInt(ctx.minAmount)) return fail('amount below invoice total');
  if (!ctx.memos?.includes(a.args.memo)) return fail('transfer memo must be the invoice number'); // settlement is bound to one invoice
  if (d.maxBlockHeight <= BigInt(ctx.currentBlockHeight)) return fail('delegate action expired');
  if (d.maxBlockHeight - BigInt(ctx.currentBlockHeight) > 2000n) return fail('expiry too far in the future');
  return { ok: true };
}
