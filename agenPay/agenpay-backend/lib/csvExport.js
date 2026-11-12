// Accountant CSV export (A23/A24). RFC 4180 quoting, UTC timestamps, fixed 6-dp amounts,
// identifiers kept as text, and spreadsheet formula injection neutralised.
import { formatUnits } from './near/units.js';

const FORMULA_START = /^[=+\-@\t\r]/;

/** Escape one cell. Customer-controlled text that starts like a formula is prefixed with ' */
export function csvCell(value) {
  if (value === null || value === undefined) return '';
  let s = value instanceof Date ? value.toISOString() : String(value);
  if (FORMULA_START.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header, rows) {
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

const amt = (base, decimals = 6) => {
  if (base === null || base === undefined || base === '') return '';
  const [w, f = ''] = formatUnits(base, decimals).split('.');
  return `${w}.${f.padEnd(decimals, '0')}`;
};
const iso = (d) => (d ? new Date(d).toISOString() : '');

export function invoicesCsv(invoices, explorerTx) {
  const header = [
    'invoice_id', 'invoice_number', 'customer_name', 'customer_email', 'description',
    'issue_date_utc', 'due_date_utc', 'invoice_currency', 'amount_due', 'status',
    'destination_asset_contract', 'destination_network', 'receiving_account',
    'settled_amount', 'network_fee_paid_by_merchant', 'settled_at_utc', 'transaction_hash', 'transaction_url',
  ];
  const rows = invoices.map((i) => [
    i.id, i.number, i.customerName, i.customerEmail, i.description,
    iso(i.createdAt), iso(i.dueDate), i.asset, amt(i.amount, i.decimals), i.status,
    i.assetContract, i.network, i.receiver,
    amt(i.settledAmount, i.decimals), '0.000000', iso(i.settledAt), i.settledTxHash,
    i.settledTxHash ? explorerTx(i.settledTxHash) : '',
  ]);
  return toCsv(header, rows);
}

export function paymentsCsv(attempts, explorerTx) {
  const header = [
    'payment_id', 'direction', 'invoice_number', 'counterparty', 'amount', 'currency', 'network',
    'status', 'transaction_hash', 'transaction_url', 'error', 'created_at_utc', 'updated_at_utc',
  ];
  const rows = attempts.map((p) => [
    p.paymentId, p.direction === 'IN' ? 'incoming' : 'outgoing', p.invoice?.number, p.recipient,
    amt(p.amount), p.asset, p.network, p.status, p.txHash, p.txHash ? explorerTx(p.txHash) : '',
    p.error, iso(p.createdAt), iso(p.updatedAt),
  ]);
  return toCsv(header, rows);
}

export const CSV_NOTE =
  'Amounts are USDC-denominated stablecoin units (6 decimals), not bank-deposited dollars. Times are UTC. ' +
  'Network fees are paid by the payer or by the SkyPay sponsor, so merchant fee is 0.';
