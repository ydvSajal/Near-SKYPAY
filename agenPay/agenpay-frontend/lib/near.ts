// Browser-side NEAR signing. The company owner's private key is generated and kept in this
// browser (localStorage) and is never sent to SkyPay. The owner signs delegate actions; SkyPay's
// relayer only pays the gas and refuses anything outside the vault policy methods.
import { authService } from "@/lib/auth"

const RPC = process.env.NEXT_PUBLIC_NEAR_RPC_URL || "https://test.rpc.fastnear.com"
const TGAS = BigInt("1000000000000")
const keyName = (userId: string) => `skypay_near_owner_key_${userId}`

export function getStoredOwnerKey(userId: string): string | null {
  try {
    return localStorage.getItem(keyName(userId))
  } catch {
    return null
  }
}

/** Create (once) the owner key in this browser and return its public key. */
export async function ensureOwnerKey(userId: string): Promise<{ publicKey: string; secret: string }> {
  const { KeyPair } = await import("near-api-js")
  let secret = getStoredOwnerKey(userId)
  if (!secret) {
    secret = KeyPair.fromRandom("ed25519").toString()
    localStorage.setItem(keyName(userId), secret)
  }
  const kp = KeyPair.fromString(secret as `ed25519:${string}`)
  return { publicKey: kp.getPublicKey().toString(), secret }
}

export function importOwnerKey(userId: string, secret: string) {
  if (!/^ed25519:[1-9A-HJ-NP-Za-km-z]{60,100}$/.test(secret.trim())) throw new Error("Not an ed25519 secret key")
  localStorage.setItem(keyName(userId), secret.trim())
}

function toBase64(bytes: Uint8Array): string {
  let s = ""
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s)
}

/**
 * Sign one function call as the company owner and submit it through SkyPay's sponsor.
 * Returns the explorer URL of the relayed transaction.
 */
export async function ownerAction(opts: {
  userId: string
  company: string
  receiverId: string
  method: string
  args: Record<string, unknown>
  depositYocto?: bigint
  tgas?: number
  label: string
}): Promise<{ txHash: string; url: string }> {
  const { Account, JsonRpcProvider, KeyPairSigner, actions, encodeSignedDelegate } = await import("near-api-js")
  const secret = getStoredOwnerKey(opts.userId)
  if (!secret) throw new Error("Owner key not found in this browser. Import it from your backup.")
  const owner = new Account(opts.company, new JsonRpcProvider({ url: RPC }), KeyPairSigner.fromSecretKey(secret as `ed25519:${string}`))
  const { signedDelegate } = await owner.createSignedMetaTransaction({
    receiverId: opts.receiverId,
    actions: [actions.functionCall(opts.method, opts.args, BigInt(opts.tgas ?? 30) * TGAS, opts.depositYocto ?? BigInt(0))],
    blockHeightTtl: 120,
  })
  return authService.api("/api/near/relay", {
    method: "POST",
    body: JSON.stringify({ signedDelegate: toBase64(encodeSignedDelegate(signedDelegate)), label: opts.label }),
  })
}

/** "12.5" -> "12500000" for 6-decimal USDC; integer-safe. */
export function toBaseUnits(amount: string, decimals = 6): string {
  const s = amount.trim()
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error("Enter a positive amount like 25 or 12.50")
  const [w, f = ""] = s.split(".")
  if (f.length > decimals) throw new Error(`At most ${decimals} decimal places`)
  return (BigInt(w) * BigInt(10) ** BigInt(decimals) + BigInt((f.padEnd(decimals, "0")) || "0")).toString()
}

export function fromBaseUnits(base: string | null | undefined, decimals = 6): string {
  if (!base) return "0"
  const v = BigInt(base)
  const d = BigInt(10) ** BigInt(decimals)
  const frac = (v % d).toString().padStart(decimals, "0").replace(/0+$/, "")
  return `${v / d}${frac ? "." + frac : ""}`
}
