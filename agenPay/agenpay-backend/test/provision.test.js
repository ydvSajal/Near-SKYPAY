// Resumable provisioning: crash after ANY chain operation, retry with persisted state,
// and the same three accounts are finished; nothing is created twice and the agent ends with only the pay key.
import test from 'node:test';
import assert from 'node:assert/strict';
import { KeyPair } from 'near-api-js';
import { NearService } from '../lib/near/NearService.js';

const pubOf = (secret) => KeyPair.fromString(secret).getPublicKey().toString();

function fakeChain(crashAt) {
  const accounts = new Map(); // id -> { keys:Set, code:boolean, init:{owner}|null, registered:boolean }
  const ops = [];
  let n = 0;
  const op = (name) => {
    ops.push(name);
    if (n++ === crashAt) throw new Error(`crash after ${name}`); // the operation itself landed on chain
  };
  const near = new NearService({ NEAR_USDC_CONTRACT: 'usdc.testnet', NEAR_RELAYER_ACCOUNT: 'sponsor.testnet', NEAR_RELAYER_KEY: 'x', JWT_SECRET: 's' });
  Object.assign(near, {
    accountExists: async (id) => accounts.has(id),
    accessKeys: async (id) => [...(accounts.get(id)?.keys || [])].map((k) => ({ publicKey: k.pub, permission: k.fc ? { FunctionCall: {} } : 'FullAccess' })),
    vaultState: async (id) => { const a = accounts.get(id); if (!a?.init) throw new Error('not initialized'); return a.init; },
    createNamedAccount: async (id, pub) => {
      if (accounts.has(id)) throw new Error(`${id} created twice`);
      accounts.set(id, { keys: new Set([{ pub }]), init: null, registered: false });
      op(`create ${id}`);
    },
    registerOnToken: async (id) => { const a = accounts.get(id); if (!a.registered) { a.registered = true; op(`register ${id}`); } },
    account: (id, secret) => {
      const a = accounts.get(id);
      const has = () => [...a.keys].some((k) => k.pub === pubOf(secret));
      return {
        deployContract: async () => { assert.ok(has(), 'signed with a key the account has'); op(`deploy ${id}`); },
        callFunctionRaw: async ({ methodName, args }) => {
          assert.ok(has());
          if (methodName === 'new') { if (a.init) throw new Error('already initialized'); a.init = { owner: args.owner }; }
          op(`${methodName} ${id}`);
        },
        deleteKey: async (pub) => { assert.ok(has()); a.keys = new Set([...a.keys].filter((k) => k.pub !== pub)); op(`deleteKey ${id}`); },
        addFunctionCallAccessKey: async ({ publicKey }) => { assert.ok(has()); a.keys.add({ pub: publicKey, fc: true }); op(`addKey ${id}`); },
      };
    },
  });
  return { near, accounts, ops };
}

test('provisioning resumes after a crash at every step without duplicate accounts', async () => {
  const owner = KeyPair.fromRandom('ed25519').getPublicKey().toString();
  // count operations in a clean run first
  const clean = fakeChain(-1);
  await clean.near.provision({ slug: 'acme1234', ownerPublicKey: owner });
  const total = clean.ops.length;
  assert.ok(total >= 9);

  for (let crashAt = 0; crashAt < total; crashAt++) {
    const { near, accounts } = fakeChain(crashAt);
    let state = null;
    const save = async (s) => { state = structuredClone(s); };
    await assert.rejects(near.provision({ slug: 'acme1234', ownerPublicKey: owner, state, save }), /crash after/);
    // resume (the crash flag fires only once)
    const p = await near.provision({ slug: 'acme1234', ownerPublicKey: owner, state, save });
    assert.equal(accounts.size, 3, `crashAt=${crashAt}`);
    assert.equal(p.vault, 'acme1234-vault.testnet');
    const vault = accounts.get(p.vault);
    assert.equal(vault.keys.size, 0, `vault keyless after crashAt=${crashAt}`);
    assert.equal(vault.init.owner, 'acme1234.testnet');
    const agentKeys = [...accounts.get(p.agent).keys];
    assert.equal(agentKeys.length, 1, `agent has only the pay key after crashAt=${crashAt}`);
    assert.ok(agentKeys[0].fc);
    assert.equal(KeyPair.fromString(near.decrypt(p.agentKeyEnc)).getPublicKey().toString(), agentKeys[0].pub);
    assert.ok(accounts.get(p.company).registered && vault.registered);
  }
});

test('a failed key-list read during resume stops setup instead of treating the vault as keyless', async () => {
  const owner = KeyPair.fromRandom('ed25519').getPublicKey().toString();
  // crash right after the vault contract is initialized (vault key still installed)
  const { near, accounts, ops } = fakeChain(3);
  let state = null;
  const save = async (s) => { state = structuredClone(s); };
  await assert.rejects(near.provision({ slug: 'acme1234', ownerPublicKey: owner, state, save }), /crash after/);
  assert.match(ops.at(-1), /^new /);
  const realKeys = near.accessKeys;
  near.accessKeys = async (id) => { if (id.endsWith('-vault.testnet')) throw new Error('could not read access keys: RPC timeout'); return realKeys(id); };
  await assert.rejects(near.provision({ slug: 'acme1234', ownerPublicKey: owner, state, save }), /could not read access keys/);
  assert.ok(!state.done?.includes('vault'), 'vault step is not marked done');
  assert.equal(accounts.get('acme1234-vault.testnet').keys.size, 1, 'key still present, and setup did not report success');
  near.accessKeys = realKeys; // RPC recovers: resume finishes and deletes the key
  await near.provision({ slug: 'acme1234', ownerPublicKey: owner, state, save });
  assert.equal(accounts.get('acme1234-vault.testnet').keys.size, 0);
});

test('setup verifies on chain that the vault really became keyless', async () => {
  const owner = KeyPair.fromRandom('ed25519').getPublicKey().toString();
  const { near } = fakeChain(-1);
  const realAccount = near.account;
  near.account = (id, secret) => { const a = realAccount(id, secret); if (id.endsWith('-vault.testnet')) a.deleteKey = async () => {}; return a; };
  await assert.rejects(near.provision({ slug: 'acme1234', ownerPublicKey: owner }), /still has 1 access key/);
});

test('accessKeys fails closed on RPC errors; only a missing account reads as no keys', async () => {
  const near = new NearService({ NEAR_USDC_CONTRACT: 't', NEAR_RELAYER_ACCOUNT: 'r', NEAR_RELAYER_KEY: 'x', JWT_SECRET: 's' });
  near.rpc = async () => { throw Object.assign(new Error('Server error'), { rpcError: { name: 'HANDLER_ERROR', cause: { name: 'TIMEOUT_ERROR' } } }); };
  await assert.rejects(near.accessKeys('v.testnet'), /could not read access keys/);
  near.rpc = async () => { throw Object.assign(new Error('account v.testnet does not exist while viewing'), { rpcError: { cause: { name: 'UNKNOWN_ACCOUNT' } } }); };
  assert.deepEqual(await near.accessKeys('v.testnet'), []);
  near.rpc = async () => ({});
  await assert.rejects(near.accessKeys('v.testnet'), /malformed/);
});

test('resume refuses a different owner key', async () => {
  const { near } = fakeChain(-1);
  await assert.rejects(near.provision({ slug: 'x1', ownerPublicKey: 'ed25519:B', state: { slug: 'x1', ownerPublicKey: 'ed25519:A' } }), { status: 409 });
});
