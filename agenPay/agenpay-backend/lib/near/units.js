// Integer base-unit money helpers. Never use JS floats for money.
// USDC on NEAR has 6 decimals. All amounts travel as decimal strings of base units.

/** "12.5" -> "12500000" (throws on >decimals places, negatives, junk) */
export function parseUnits(str, decimals = 6) {
  const s = String(str).trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`invalid amount: ${str}`);
  const [whole, frac = ''] = s.split('.');
  if (frac.length > decimals) throw new Error(`too many decimal places (max ${decimals})`);
  return (BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, '0') || '0')).toString();
}

/** "12500000" -> "12.5" */
export function formatUnits(baseUnits, decimals = 6) {
  const v = BigInt(baseUnits);
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = (abs % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${whole}${frac ? '.' + frac : ''}`;
}

/** Strict base-unit string check: digits only, no leading zeros (except "0"). */
export function isBaseUnits(s) {
  return typeof s === 'string' && /^(0|[1-9]\d*)$/.test(s);
}

/** Sum of line items [{quantity, unitAmount}] where unitAmount is base units string. */
export function sumLineItems(items) {
  return items
    .reduce((acc, it) => {
      if (!isBaseUnits(String(it.unitAmount)) || !Number.isInteger(it.quantity) || it.quantity < 1) {
        throw new Error('invalid line item');
      }
      return acc + BigInt(it.unitAmount) * BigInt(it.quantity);
    }, 0n)
    .toString();
}
