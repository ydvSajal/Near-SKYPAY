// Payer-side NEAR wallet checkout (Wallet Selector). The payer's wallet signs one USDC ft_transfer to the invoice
// receiver; SkyPay never sees a key. The invoice still closes only after the backend verifies the transaction on-chain.
import type { WalletSelector } from "@near-wallet-selector/core"
import "@near-wallet-selector/modal-ui/styles.css"
import { actionCreators } from "@near-js/transactions"

export interface PayableInvoice {
  amount: string // base units, server-owned
  number: string
  receiver: string
  assetContract: string
  network: string // near:testnet | near:mainnet
  isTestToken: boolean
}

const GAS = BigInt("30000000000000") // 30 Tgas
let selectorPromise: Promise<WalletSelector> | null = null

const networkId = (inv: Pick<PayableInvoice, "network">) => (inv.network === "near:mainnet" ? "mainnet" : "testnet")

/** Lazy, browser-only init so SSR never touches wallet code. */
async function getSelector(inv: PayableInvoice): Promise<WalletSelector> {
  if (!selectorPromise) {
    selectorPromise = (async () => {
      const [{ setupWalletSelector }, { setupMyNearWallet }, { setupMeteorWallet }] = await Promise.all([
        import("@near-wallet-selector/core"),
        import("@near-wallet-selector/my-near-wallet"),
        import("@near-wallet-selector/meteor-wallet"),
      ])
      return setupWalletSelector({ network: networkId(inv), modules: [setupMyNearWallet(), setupMeteorWallet()] })
    })()
    selectorPromise.catch(() => (selectorPromise = null))
  }
  return selectorPromise
}

export interface WalletPayment {
  txHash: string
  sender: string
}

/**
 * Connect (if needed) and pay the invoice. Resolves with the transaction hash once the wallet reports it.
 * On testnet with the open test token, the payer first mints the invoice amount to themselves in the same transaction
 * (no value; labelled in the UI). Throws a readable Error when the user rejects or the wallet fails.
 */
export async function payWithWallet(inv: PayableInvoice): Promise<WalletPayment> {
  const selector = await getSelector(inv)
  if (!selector.isSignedIn()) {
    const { setupModal } = await import("@near-wallet-selector/modal-ui")
    const modal = setupModal(selector, { contractId: inv.assetContract, methodNames: ["ft_transfer"] })
    modal.show()
    await new Promise<void>((resolve, reject) => {
      const sub = selector.on("signedIn", () => {
        sub.remove()
        resolve()
      })
      modal.on("onHide", () => {
        if (!selector.isSignedIn()) {
          sub.remove()
          reject(new Error("Wallet connection cancelled"))
        }
      })
    })
  }
  const wallet = await selector.wallet()
  const accounts = await wallet.getAccounts()
  const sender = accounts[0]?.accountId
  if (!sender) throw new Error("No account available in the wallet")

  const actions = []
  if (inv.isTestToken) actions.push(actionCreators.functionCall("mint", { account_id: sender, amount: inv.amount }, GAS, BigInt(0)))
  // 1 yoctoNEAR deposit is required by NEP-141 ft_transfer
  actions.push(actionCreators.functionCall("ft_transfer", { receiver_id: inv.receiver, amount: inv.amount, memo: inv.number }, GAS, BigInt(1)))

  try {
    const outcome = await wallet.signAndSendTransaction({ signerId: sender, receiverId: inv.assetContract, actions })
    const txHash = outcome && "transaction" in outcome ? outcome.transaction?.hash : undefined
    if (!txHash) throw new Error("Wallet did not return a transaction hash; use the manual verify option below")
    return { txHash, sender }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new Error(/reject|cancel|denied|closed/i.test(msg) ? "Payment cancelled in the wallet" : msg)
  }
}

/** Sign out the wallet session (so the next payer can connect another account). */
export async function walletSignOut(inv: PayableInvoice) {
  const selector = await getSelector(inv)
  if (selector.isSignedIn()) await (await selector.wallet()).signOut()
}
