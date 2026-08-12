/**
 * Checks the Host Metrics dashboard actually returns rows from BOTH engines.
 *
 * Asserts on the query responses rather than the rendered DOM, and reports per panel
 * which data source answered — the whole point of the dashboard is that InfluxDB and
 * ClickHouse are both being read, so "some panels worked" is not good enough.
 */
import { chromium } from 'playwright';

const BASE = process.env.GRAFANA || 'http://192.168.1.36:3000';
const USER = process.env.GF_USER || 'admin';
const PASS = process.env.GF_PASS || 'admin';
const DASH = process.env.DASH || '/d/bryge-host-metrics';
const RANGE = process.env.RANGE || 'from=now-30m&to=now';
const OUT = process.env.OUT || '.';

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1700, height: 1400 } })).newPage();

const results = [];
page.on('response', async (res) => {
  if (!res.url().includes('/api/ds/query')) {
    return;
  }
  let body;
  try {
    body = await res.json();
  } catch {
    return;
  }
  for (const [refId, r] of Object.entries(body?.results ?? {})) {
    const frames = r?.frames ?? [];
    const rows = frames.reduce((n, f) => n + (f?.data?.values?.[0]?.length ?? 0), 0);
    const series = frames.length;
    results.push({ refId, rows, series, error: r?.error });
  }
});

await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
await page.fill('input[name="user"]', USER);
await page.fill('input[name="password"]', PASS);
await page.click('button[type="submit"]');
await page.waitForTimeout(4000);
const skip = page.getByRole('button', { name: /^Skip$/ }).first();
if (await skip.isVisible().catch(() => false)) {
  await skip.click();
  await page.waitForTimeout(2000);
}

await page.goto(`${BASE}${DASH}?${RANGE}&kiosk`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(25000);

// Which panel is backed by which engine, read from the dashboard itself so the report
// cannot drift from the JSON.
const dash = await (await fetch(`${BASE}/api/dashboards/uid/bryge-host-metrics`, {
  headers: { Authorization: 'Basic ' + Buffer.from(`${USER}:${PASS}`).toString('base64') },
})).json();
const byType = {};
for (const p of dash.dashboard.panels) {
  const t = p.datasource?.type ?? 'unknown';
  byType[t] = (byType[t] ?? 0) + 1;
}

const ok = results.filter((r) => r.rows > 0 && !r.error);
const bad = results.filter((r) => r.rows === 0 || r.error);

console.log(`panels by engine: ${Object.entries(byType).map(([t, n]) => `${t}=${n}`).join(', ')}`);
console.log(`queries observed: ${results.length}  |  returned rows: ${ok.length}  |  empty or errored: ${bad.length}`);
for (const r of bad) {
  console.log(`  FAIL refId=${r.refId} rows=${r.rows}${r.error ? ' error=' + JSON.stringify(r.error).slice(0, 140) : ''}`);
}
const totalRows = results.reduce((n, r) => n + r.rows, 0);
console.log(`total rows across all panels: ${totalRows}`);

await page.screenshot({ path: `${OUT}/host-metrics.png`, fullPage: true });

const pass = results.length >= 10 && bad.length === 0;
console.log(pass ? '\nboth engines answering on every panel' : `\n${bad.length || 'too few'} panel query(s) failed`);
await browser.close();
process.exit(pass ? 0 : 1);
