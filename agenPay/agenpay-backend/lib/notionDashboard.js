// Notion dashboard for the SkyPay workspace: section headers + a 2x2 grid of colored stat cards (callouts).
// Layout is built once; numbers and the activity list are then updated in place from the database
// (Notion is a view, never the ledger). Block ids are kept in SystemConfig under `notion_dash:<userId>`.
import crypto from 'node:crypto';

const rt = (content, gray = false) => [{ type: 'text', text: { content }, ...(gray ? { annotations: { color: 'gray' } } : {}) }];
const para = (content, gray = true) => ({ object: 'block', type: 'paragraph', paragraph: { rich_text: rt(content, gray) } });
const callout = (rich_text, emoji, color) => ({ object: 'block', type: 'callout', callout: { rich_text, icon: { type: 'emoji', emoji }, color } });
const section = (title, emoji) => callout(rt(title), emoji, 'gray_background');
// card text: label, value (bold), sub-line (gray)
const kpiText = (label, value, sub) => [
  { type: 'text', text: { content: `${label}\n` } },
  { type: 'text', text: { content: value }, annotations: { bold: true } },
  { type: 'text', text: { content: `\n${sub}` }, annotations: { color: 'gray' } },
];
const bullet = (content) => ({ object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: rt(content) } });
const divider = () => ({ object: 'block', type: 'divider', divider: {} });
const cap = (s) => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);
const cfgKey = (userId) => `notion_dash:${userId}`;

const KPIS = [
  { label: 'Collected', emoji: '📥', color: 'green_background' },
  { label: 'Outstanding', emoji: '🧾', color: 'yellow_background' },
  { label: 'Paid to suppliers', emoji: '📤', color: 'red_background' },
  { label: 'Invoices issued', emoji: '🔄', color: 'blue_background' },
];
const GRID = [[0, 2], [1, 3]]; // KPI indexes per column: 2x2 cards, row 1 = Collected | Outstanding

function intro({ network, isTest, updatedAt }) {
  const unit = `USDC on NEAR ${network}${isTest ? ' (test token, no value)' : ''}`;
  return `Invoices and supplier payments, kept in sync by your SkyPay agent. Amounts in ${unit}. Updated ${updatedAt}.`;
}

/** Header, key figures and the "Records" heading. Sub-pages are created right after, so they list under it. */
export async function buildTop(notion, prisma, userId, pageId, { network, isTest }) {
  const first = await notion.blocks.children.append({
    block_id: pageId,
    children: [
      para(intro({ network, isTest, updatedAt: 'just now' })),
      section('Payment statistics', '📈'),
      {
        object: 'block', type: 'column_list',
        column_list: {
          children: GRID.map((idx) => ({
            object: 'block', type: 'column',
            column: { children: idx.map((i) => callout(kpiText(KPIS[i].label, '0.00', 'No data yet'), KPIS[i].emoji, KPIS[i].color)) },
          })),
        },
      },
      divider(),
      section('Records', '🗂️'),
    ],
  });
  const introId = first.results.find((b) => b.type === 'paragraph').id;
  const columnList = first.results.find((b) => b.type === 'column_list');
  const columns = (await notion.blocks.children.list({ block_id: columnList.id })).results;
  const kpis = [];
  for (const [c, col] of columns.entries()) {
    const kids = (await notion.blocks.children.list({ block_id: col.id })).results;
    GRID[c].forEach((i, k) => { kpis[i] = kids[k].id; });
  }
  // blocks = every top-level block SkyPay put on the page, so a rebuild removes exactly those
  const ids = { pageId, intro: introId, kpis, recent: [], blocks: first.results.map((b) => b.id), hash: '', network, isTest };
  await save(prisma, userId, ids);
  return ids;
}

/** "Recent activity" heading and a first bullet, appended after the sub-pages. */
export async function buildRecent(notion, prisma, userId, databaseIds = []) {
  const ids = await load(prisma, userId);
  const r = await notion.blocks.children.append({ block_id: ids.pageId, children: [divider(), section('Recent activity', '📅'), bullet('No activity yet.')] });
  ids.recent = r.results.filter((b) => b.type === 'bulleted_list_item').map((b) => b.id);
  // a database's child_database block id is the database id: deleting it trashes the database
  ids.blocks = [...(ids.blocks || []), ...databaseIds, ...r.results.filter((b) => b.type !== 'bulleted_list_item').map((b) => b.id)];
  await save(prisma, userId, ids);
}

/** Remove everything SkyPay added to the page (to Notion trash, recoverable). The user's own blocks stay. */
export async function clearDashboard(notion, prisma, userId) {
  const ids = await load(prisma, userId);
  for (const id of [...(ids?.blocks || []), ...(ids?.recent || [])]) await notion.blocks.delete({ block_id: id }).catch(() => {});
}

async function load(prisma, userId) {
  const row = await prisma.systemConfig.findUnique({ where: { key: cfgKey(userId) } });
  return row ? JSON.parse(row.value) : null;
}
async function save(prisma, userId, ids) {
  const value = JSON.stringify(ids);
  await prisma.systemConfig.upsert({ where: { key: cfgKey(userId) }, update: { value }, create: { key: cfgKey(userId), value } });
}

/** Base units -> "1,234.50" (2 dp, truncated: display only, exact values live in the CSV export). */
function fmt(v, dec) {
  const b = BigInt(v), base = 10n ** BigInt(dec);
  const whole = (b / base).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${whole}.${((b % base) * 100n / base).toString().padStart(2, '0')}`;
}

const sum = (xs) => xs.reduce((a, x) => a + BigInt(x || 0), 0n);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** Everything the dashboard shows, computed from the ledger tables. */
export async function dashboardStats(prisma, userId) {
  const [invoices, payments] = await Promise.all([
    prisma.invoice.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } }),
    prisma.paymentAttempt.findMany({ where: { userId, direction: 'OUT' }, orderBy: { createdAt: 'desc' }, take: 50 }),
  ]);
  const dec = invoices[0]?.decimals ?? 6;
  const f = (v) => fmt(v, dec);
  const paid = invoices.filter((i) => i.status === 'paid');
  const open = invoices.filter((i) => i.status === 'pending');
  const sent = payments.filter((p) => p.status === 'settled');
  const kpis = [
    { value: `${f(sum(paid.map((i) => i.settledAmount ?? i.amount)))} USDC`, sub: plural(paid.length, 'paid invoice') },
    { value: `${f(sum(open.map((i) => i.amount)))} USDC`, sub: plural(open.length, 'open invoice') },
    { value: `${f(sum(sent.map((p) => p.amount)))} USDC`, sub: plural(sent.length, 'supplier payment') },
    { value: String(invoices.length), sub: 'in total' },
  ];
  const rows = [
    ...invoices.map((i) => ({ at: i.createdAt, text: `${i.number} · ${i.customerName || i.customerEmail} · ${f(i.amount)} USDC · ${cap(i.status)}` })),
    ...payments.map((p) => ({ at: p.createdAt, text: `Supplier payment · ${p.recipient || 'payee'} · ${f(p.amount)} USDC · ${cap(p.status)}` })),
  ].sort((a, b) => b.at - a.at).slice(0, 8).map((r) => r.text);
  return { kpis, recent: rows.length ? rows : ['No activity yet.'] };
}

/** Update numbers and the activity list in place. Skips the API calls when nothing changed. Returns true if it wrote. */
export async function refreshDashboard(notion, prisma, userId) {
  const ids = await load(prisma, userId);
  if (!ids) return false;
  const stats = await dashboardStats(prisma, userId);
  const hash = crypto.createHash('sha1').update(JSON.stringify(stats)).digest('hex');
  if (hash === ids.hash) return false;

  for (let i = 0; i < KPIS.length && ids.kpis[i]; i++) {
    await notion.blocks.update({ block_id: ids.kpis[i], callout: { rich_text: kpiText(KPIS[i].label, stats.kpis[i].value, stats.kpis[i].sub) } });
  }
  await notion.blocks.update({
    block_id: ids.intro,
    paragraph: { rich_text: rt(intro({ network: ids.network, isTest: ids.isTest, updatedAt: `${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC` }), true) },
  });
  // the activity list is the last section of the page: replace its bullets
  const pageId = ids.pageId;
  for (const id of ids.recent) await notion.blocks.delete({ block_id: id }).catch(() => {});
  const r = await notion.blocks.children.append({ block_id: pageId, children: stats.recent.map(bullet) });
  ids.recent = r.results.map((b) => b.id);
  ids.hash = hash;
  await save(prisma, userId, ids);
  return true;
}
