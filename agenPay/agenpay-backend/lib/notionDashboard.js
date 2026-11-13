// Notion dashboard for the SkyPay workspace: a quiet, text-only layout (no emoji, no colored boxes).
// Layout is built once; numbers and the activity list are then updated in place from the database
// (Notion is a view, never the ledger). Block ids are kept in SystemConfig under `notion_dash:<userId>`.
import crypto from 'node:crypto';

const rt = (content, gray = false) => [{ type: 'text', text: { content }, ...(gray ? { annotations: { color: 'gray' } } : {}) }];
const para = (content, gray = true) => ({ object: 'block', type: 'paragraph', paragraph: { rich_text: rt(content, gray) } });
const h2 = (content) => ({ object: 'block', type: 'heading_2', heading_2: { rich_text: rt(content) } });
const h3 = (content) => ({ object: 'block', type: 'heading_3', heading_3: { rich_text: rt(content) } });
const bullet = (content) => ({ object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: rt(content) } });
const divider = () => ({ object: 'block', type: 'divider', divider: {} });
const cap = (s) => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);
const cfgKey = (userId) => `notion_dash:${userId}`;

const KPI_LABELS = ['Collected', 'Outstanding', 'Paid to suppliers', 'Invoices issued'];

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
      divider(),
      {
        object: 'block', type: 'column_list',
        column_list: {
          children: KPI_LABELS.map((label) => ({
            object: 'block', type: 'column',
            column: { children: [para(label), h2('0.00'), para('No data yet')] },
          })),
        },
      },
      divider(),
      h3('Records'),
    ],
  });
  const introId = first.results.find((b) => b.type === 'paragraph').id;
  const columnList = first.results.find((b) => b.type === 'column_list');
  const columns = (await notion.blocks.children.list({ block_id: columnList.id })).results;
  const kpis = [];
  for (const col of columns) {
    const kids = (await notion.blocks.children.list({ block_id: col.id })).results;
    kpis.push({ value: kids[1].id, sub: kids[2].id });
  }
  const ids = { pageId, intro: introId, kpis, recent: [], hash: '', network, isTest };
  await save(prisma, userId, ids);
  return ids;
}

/** "Recent activity" heading and a first bullet, appended after the sub-pages. */
export async function buildRecent(notion, prisma, userId) {
  const ids = await load(prisma, userId);
  const r = await notion.blocks.children.append({ block_id: ids.pageId, children: [h3('Recent activity'), bullet('No activity yet.')] });
  ids.recent = r.results.filter((b) => b.type === 'bulleted_list_item').map((b) => b.id);
  await save(prisma, userId, ids);
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

  for (let i = 0; i < KPI_LABELS.length && ids.kpis[i]; i++) {
    await notion.blocks.update({ block_id: ids.kpis[i].value, heading_2: { rich_text: rt(stats.kpis[i].value) } });
    await notion.blocks.update({ block_id: ids.kpis[i].sub, paragraph: { rich_text: rt(stats.kpis[i].sub, true) } });
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
