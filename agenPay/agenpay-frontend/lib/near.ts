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

/** Public key of a stored/typed secret, or null if it is not a valid ed25519 secret. */
export async function publicKeyOf(secret: string | null): Promise<string | null> {
  if (!secret) return null
  try {
    const { KeyPair } = await import("near-api-js")
    return KeyPair.fromString(secret.trim() as `ed25519:${string}`).getPublicKey().toString()
  } catch {
    return null
  }
}

/**
 * Restore an owner key from a backup (the whole backup file text or just the key).
 * Refused BEFORE it is stored when it is not the company's registered owner key, so a wrong file
 * can never replace a working key or fail later at signing time.
 */
export async function importOwnerKey(userId: string, text: string, expectedPublicKey: string | null) {
  const secret = text.match(/ed25519:[1-9A-HJ-NP-Za-km-z]{60,100}/)?.[0]
  if (!secret) throw new Error("No ed25519 secret key found. Paste the key or the whole backup file.")
  const pub = await publicKeyOf(secret)
  if (!pub) throw new Error("That key could not be read.")
  if (expectedPublicKey && pub !== expectedPublicKey) {
    throw new Error(`This key does not belong to this company (its public key is ${pub.slice(0, 20)}…, the company's owner key is ${expectedPublicKey.slice(0, 20)}…). Nothing was changed.`)
  }
  localStorage.setItem(keyName(userId), secret)
}

const backupName = (userId: string) => `skypay_owner_backup_saved_${userId}`
export function backupSaved(userId: string): boolean {
  try { return localStorage.getItem(backupName(userId)) === "1" } catch { return false }
}

/** Save the browser-held owner key as a text file. Returns false when no key is stored. */
export function downloadOwnerKeyBackup(userId: string, company: string | null): boolean {
  const secret = getStoredOwnerKey(userId)
  if (!secret) return false
  try { localStorage.setItem(backupName(userId), "1") } catch { /* private mode: reminder just stays visible */ }
  const blob = new Blob(
    [`SkyPay company owner key for ${company}\nKeep this file private. Anyone with it controls the company account.\n\n${secret}\n`],
    { type: "text/plain" },
  )
  const a = document.createElement("a")
  a.href = URL.createObjectURL(blob)
  a.download = `skypay-owner-key-${company}.txt`
  a.click()
  URL.revokeObjectURL(a.href)
  return true
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
