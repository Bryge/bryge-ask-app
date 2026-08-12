/**
 * Uninstalling must leave nothing broken behind.
 *
 * Presses "Remove Bryge from these dashboards" and checks the three things that would
 * otherwise rot: the chat panel is gone from the dashboard, the connection is deleted,
 * and the panel menu no longer offers a link that opens onto nothing.
 */
import { chromium } from 'playwright';

const BASE = process.env.GRAFANA || 'http://192.168.1.36:3000';
const USER = process.env.GF_USER || 'admin';
const PASS = process.env.GF_PASS || 'admin';
const DASH_UID = process.env.DASH_UID || 'bryge-plant-energy';
const PANEL = process.env.PANEL || 'Phase voltages';

const auth = 'Basic ' + Buffer.from(`${USER}:${PASS}`).toString('base64');
const api = async (path) => (await fetch(`${BASE}${path}`, { headers: { Authorization: auth } })).json();

const fail = [];
const check = (ok, label, detail = '') => {
  console.log(`${ok ? ' ok ' : 'FAIL'} ${label}${detail ? ' | ' + detail : ''}`);
  if (!ok) {
    fail.push(label);
  }
};

// before
const before = await api(`/api/dashboards/uid/${DASH_UID}`);
const hadPanel = (before.dashboard?.panels ?? []).some((p) => p.type === 'bryge-ask-panel');
check(hadPanel, 'chat panel is on the dashboard before removal');

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1200 } })).newPage();
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

await page.goto(`${BASE}/plugins/bryge-ask-app?page=configuration`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(12000);
const button = page.getByRole('button', { name: /Remove Bryge from these dashboards/ });
check(await button.isVisible().catch(() => false), 'removal button offered');
await button.click();
await page.waitForSelector('text=/It is now safe to uninstall/', { timeout: 120000 }).catch(() => {});
check(/It is now safe to uninstall/.test(await page.locator('body').innerText()), 'removal reported success');

// after
const after = await api(`/api/dashboards/uid/${DASH_UID}`);
const stillHasPanel = (after.dashboard?.panels ?? []).some((p) => p.type === 'bryge-ask-panel');
check(!stillHasPanel, 'chat panel removed from the dashboard');

const otherPanels = (after.dashboard?.panels ?? []).length;
check(otherPanels >= 8, 'the dashboard\'s own panels were left alone', `${otherPanels} panels remain`);

const datasources = await api('/api/datasources');
check(!datasources.some((d) => d.type === 'bryge-ask-datasource'), 'Bryge connection deleted');
check(datasources.some((d) => d.uid === 'plant-timescale'), 'the plant data source was left alone');

// the menu link must be gone too, on a fresh load
await page.goto(`${BASE}/d/${DASH_UID}?from=now-6h&to=now`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(12000);
await page.getByTestId(`data-testid Panel header ${PANEL}`).hover();
await page.getByTestId(`data-testid Panel menu ${PANEL}`).click({ timeout: 15000 });
await page.waitForTimeout(1500);
let visible = await page.getByRole('menuitem', { name: /Ask Bryge/ }).first().isVisible().catch(() => false);
if (!visible) {
  const more = page.getByRole('menuitem', { name: /More|Extensions/ }).first();
  if (await more.isVisible().catch(() => false)) {
    await more.hover();
    await page.waitForTimeout(1200);
    visible = await page.getByRole('menuitem', { name: /Ask Bryge/ }).first().isVisible().catch(() => false);
  }
}
check(!visible, '"Ask Bryge" gone from the panel menu');

// and the dashboard still renders its own data
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`${BASE}/d/${DASH_UID}?from=now-6h&to=now&kiosk`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(15000);
const text = await page.locator('body').innerText();
check(!/Panel plugin not found/i.test(text), 'no broken panel tiles left behind');

console.log(fail.length ? `\n${fail.length} check(s) failed: ${fail.join('; ')}` : '\nremoval leaves the dashboard clean');
await browser.close();
process.exit(fail.length ? 1 : 0);
