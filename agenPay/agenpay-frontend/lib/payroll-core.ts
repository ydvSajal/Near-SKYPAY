// Payroll sheet -> validated rows. Pure functions (no DOM), so they run in the browser and in `node --test`.
// The sheet only fills a preview: nothing here registers payees or moves money.

export type Cell = unknown // xlsx cells are string | number | boolean | Date | null
export interface PayrollRow { line: number; name: string; nearAccount: string; email: string; amount: string; role: string; memo: string; errors: string[] }

export const MAX_ROWS = 25 // matches the backend batch cap
const NEAR_ACCOUNT = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/
const AMOUNT = /^\d+(\.\d{1,6})?$/
const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/

type Field = "email" | "nearAccount" | "amount" | "role" | "memo" | "name"
// Checked in this order; each column goes to the first field that matches ("email address" is email, not account).
const FIELDS: [Field, RegExp][] = [
  ["email", /mail/],
  ["nearAccount", /near|wallet|account|address/],
  ["amount", /^(amount|amountusdc|usdc|salary|pay|payment|payout|total|sum)$/],
  ["role", /^(role|title|jobtitle|position|designation|department)$/],
  ["memo", /memo|note|description|reference|ref|info|purpose|details/],
  ["name", /^(name|employee|employeename|fullname|payee|payeename|supplier|vendor)$/],
]
const norm = (s: Cell) => String(s ?? "").toLowerCase().replace(/[^a-z]/g, "")
const text = (c: Cell) => (c instanceof Date ? c.toISOString().slice(0, 10) : String(c ?? "")).trim()

/** RFC 4180-ish CSV: quoted fields, "" escapes, CRLF/LF. Uses ; or tab when the header has no comma. */
export function parseCsv(src: string): string[][] {
  const s = src.replace(/^﻿/, "")
  const first = s.split(/\r?\n/, 1)[0]
  const sep = first.includes(",") ? "," : first.includes(";") ? ";" : first.includes("\t") ? "\t" : ","
  const rows: string[][] = []
  let row: string[] = [], cell = "", q = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (q) {
      if (c === '"' && s[i + 1] === '"') { cell += '"'; i++ }
      else if (c === '"') q = false
      else cell += c
    } else if (c === '"') q = true
    else if (c === sep) { row.push(cell); cell = "" }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++
      row.push(cell); rows.push(row); row = []; cell = ""
    } else cell += c
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  return rows
}

/** Find the header row (within the first 5) and map columns to fields. Throws a readable error. */
export function mapHeader(table: Cell[][]): { headerIndex: number; cols: Partial<Record<Field, number>> } {
  for (let h = 0; h < Math.min(5, table.length); h++) {
    const cols: Partial<Record<Field, number>> = {}
    table[h].forEach((cell, i) => {
      const n = norm(cell)
      if (!n) return
      const hit = FIELDS.find(([f, re]) => cols[f] === undefined && re.test(n))
      if (hit) cols[hit[0]] = i
    })
    if (cols.nearAccount !== undefined && cols.amount !== undefined) return { headerIndex: h, cols }
  }
  throw new Error('Could not find the columns. The sheet needs a header row with at least "NEAR account" and "Amount" (also optional: Name, Email, Memo).')
}

/** Table (rows of cells) -> validated payroll rows. Duplicated accounts are flagged, not merged. */
export function toPayrollRows(table: Cell[][]): PayrollRow[] {
  const { headerIndex, cols } = mapHeader(table)
  const get = (r: Cell[], f: Field) => (cols[f] === undefined ? "" : text(r[cols[f]!]))
  const seen = new Map<string, number>()
  const out: PayrollRow[] = []
  table.slice(headerIndex + 1).forEach((r, k) => {
    if (!r.some((c) => text(c))) return // blank line
    const line = headerIndex + k + 2 // 1-based spreadsheet line
    const nearAccount = get(r, "nearAccount").toLowerCase()
    const rawAmt = cols.amount !== undefined && typeof r[cols.amount] === "number" ? String(r[cols.amount]) : get(r, "amount")
    const amount = rawAmt.replace(/[$,\s]|usdc/gi, "")
    const email = get(r, "email")
    const errors: string[] = []
    if (!NEAR_ACCOUNT.test(nearAccount)) errors.push(nearAccount ? `"${nearAccount}" is not a valid NEAR account` : "NEAR account missing")
    if (!AMOUNT.test(amount) || Number(amount) <= 0) errors.push(amount ? `amount "${rawAmt}" is not a positive number (max 6 decimals)` : "amount missing")
    if (email && !EMAIL.test(email)) errors.push(`email "${email}" looks wrong`)
    if (seen.has(nearAccount)) errors.push(`same account as line ${seen.get(nearAccount)}`)
    else if (nearAccount) seen.set(nearAccount, line)
    out.push({ line, name: get(r, "name") || nearAccount, nearAccount, email, amount, role: get(r, "role").slice(0, 80), memo: get(r, "memo").slice(0, 120), errors })
  })
  if (!out.length) throw new Error("The sheet has a header but no rows.")
  if (out.length > MAX_ROWS) throw new Error(`The sheet has ${out.length} rows; one payout run can pay up to ${MAX_ROWS}. Split it into several files.`)
  return out
}

/** Sum of decimal strings without float drift (6 dp). */
export function sumAmounts(xs: string[]): string {
  const M = BigInt(1_000_000)
  const base = xs.reduce((a, x) => {
    const [w, f = ""] = x.split(".")
    return a + BigInt(w || "0") * M + BigInt((f + "000000").slice(0, 6))
  }, BigInt(0))
  return `${base / M}.${(base % M).toString().padStart(6, "0")}`.replace(/\.?0+$/, "")
}

export const TEMPLATE_CSV = 'Name,Role,NEAR account,Email,Amount,Memo\r\nAsha Rao,Designer,asha.testnet,asha@example.com,12.5,November salary\r\n"Lee, Sam",Engineer,sam-lee.testnet,,8,November salary\r\n'
