// Run: node --test lib/payroll-core.test.ts
import test from "node:test"
import assert from "node:assert/strict"
import { parseCsv, toPayrollRows, sumAmounts, TEMPLATE_CSV, MAX_ROWS } from "./payroll-core.ts"

test("template parses: quoted comma in name, blank email", () => {
  const rows = toPayrollRows(parseCsv(TEMPLATE_CSV))
  assert.equal(rows.length, 2)
  assert.deepEqual(rows.map((r) => [r.name, r.nearAccount, r.amount, r.errors.length]), [["Asha Rao", "asha.testnet", "12.5", 0], ["Lee, Sam", "sam-lee.testnet", "8", 0]])
  assert.equal(rows[1].line, 3)
})

test("loose headers, title row above header, xlsx-style number cells", () => {
  const rows = toPayrollRows([
    ["November payroll", null],
    ["Employee", "Email address", "Wallet", "Salary", "Role"],
    ["Asha", "asha@example.com", "ASHA.testnet", 1200.5, "Designer"],
  ])
  assert.deepEqual(rows[0], { line: 3, name: "Asha", nearAccount: "asha.testnet", email: "asha@example.com", amount: "1200.5", memo: "Designer", errors: [] })
})

test("invalid rows are flagged with reasons, duplicates point at the first line", () => {
  const rows = toPayrollRows(parseCsv("account,amount,email\nbad acct!,5,\nok.testnet,-1,\nok.testnet,1.1234567,x@\n,,\ngood.testnet,$1,000.50,\n"))
  assert.match(rows[0].errors[0], /not a valid NEAR account/)
  assert.match(rows[1].errors[0], /not a positive number/)
  assert.ok(rows[2].errors.some((e) => /same account as line 3/.test(e)))
  assert.ok(rows[2].errors.some((e) => /email/.test(e)))
  assert.equal(rows.length, 4) // blank line skipped
})

test("missing columns, empty sheet and too many rows give readable errors", () => {
  assert.throws(() => toPayrollRows([["name", "email"], ["a", "b"]]), /NEAR account/)
  assert.throws(() => toPayrollRows([["account", "amount"]]), /no rows/)
  const big = [["account", "amount"], ...Array.from({ length: MAX_ROWS + 1 }, (_, i) => [`a${i}.testnet`, "1"])]
  assert.throws(() => toPayrollRows(big), /up to 25/)
})

test("semicolon CSV and exact decimal totals", () => {
  assert.equal(toPayrollRows(parseCsv("account;amount\nx.testnet;2\n"))[0].amount, "2")
  assert.equal(sumAmounts(["0.1", "0.2", "10", "1.000001"]), "11.300001")
  assert.equal(sumAmounts(["5", "5"]), "10")
})
