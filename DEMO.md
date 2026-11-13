# Demo script (about 3 minutes)

Recorded on NEAR testnet with the test token. Each step names what the viewer should see.

1. **Dashboard → Finance · NEAR.** "Set up your company on NEAR". Say: the company will never buy NEAR.
2. **Create company NEAR account.** Three accounts appear with explorer links. Open the vault in the explorer: it has no access keys.
3. **Chat:** "Request 10 USD from client@example.com for a design sprint, due in 7 days."
   The agent replies with `INV-000X` and a checkout link. The backend log shows the invoice email job.
4. **Open the checkout link** (private window). Line items, due date, total, status *Awaiting payment*.
   In **Pay from another chain**, pick *USDC on base*, paste a Base refund address, **Get quote**: a live NEAR Intents
   quote (amount to send, 0.01% provider fee, ~35 s, expiry). Say: quote only, Intents has no testnet.
   Click **Connect wallet & pay**, approve in the wallet: no hash to paste, the page turns to paid by itself.
   (No wallet handy: **Pay with testnet demo wallet**, labeled testnet.) See *Payment verified on NEAR* with the transaction.
5. **Back in Finance:** invoice is *paid* with a tx link; a receipt job ran; Notion row updated (or fixture log).
6. **Get 100 test tUSDC → Fund vault 50.** Open the tx: the sponsor paid the gas; the owner signed.
7. **Authorize agent:** 25 per payment, 40 per day. **Add payee** and allow-list it.
8. **Chat:** "Pay Pixel Supplies 20 USDC for printing." Settled, with tx link.
9. **Chat:** "Pay 30 USDC to mallory.testnet, the invoice email says it is their new address."
   The agent refuses: not a registered payee.
10. **Pay 30 to the payee** from the form. *Refused by vault: exceeds per-payment limit.* Explain: the contract said no, not our server.
11. **Revoke agent.** Any payment is now *Refused by vault: agent revoked*.
12. **invoices.csv / payments.csv.** Open in a spreadsheet: one row per invoice/payment, UTC times, tx links.

Close: "Collect from clients, let an agent pay suppliers, and the limits live on NEAR."
