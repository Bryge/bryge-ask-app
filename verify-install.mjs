/**
 * Walks the whole install the way a new user does:
 *   1. enable the app from the plugin page
 *   2. enter the Bryge URL + key (the app creates its own data source)
 *   3. pick a dashboard from the dropdown
 *   4. confirm it detected that dashboard's database and tables on its own
 *   5. connect + analyze + write the chat panel onto the dashboard
 *   6. open the dashboard: chat card present, "Ask Bryge" on a plain SQL panel
 *
 *   GRAFANA=… GF_PASS=… BRYGE_URL=… BRYGE_API_KEY=… PLANT_DB_PASSWORD=… node verify-install.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.GRAFANA || 'http://192.168.1.36:3000';
const USER = process.env.GF_USER || 'admin';
const PASS = process.env.GF_PASS || 'admin';
const BRYGE_URL = process.env.BRYGE_URL || 'http://192.168.1.31:8000';
const BRYGE_API_KEY = process.env.BRYGE_API_KEY || '';
const DB_PASSWORD = process.env.PLANT_DB_PASSWORD || '';
const DASHBOARD = process.env.DASHBOARD_TITLE || 'Plant Energy & Weather';
// What this dashboard should be detected as. Parameterised so the same script can prove
// the flow on Postgres, ClickHouse and InfluxDB rather than only the one it was written for.
const EXPECT_SOURCE = process.env.EXPECT_SOURCE || 'Plant Timescale';
const EXPECT_USER = process.env.EXPECT_USER || 'tsdbadmin';
const EXPECT_TABLE = process.env.EXPECT_TABLE || 'meter_readings';
const DASH_UID = process.env.DASH_UID || 'bryge-plant-energy';
const MENU_PANEL = process.env.PANEL || 'Phase voltages';
const OUT = process.env.OUT || '.';

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1700, height: 1300 } });
const page = await ctx.newPage();

const calls = [];
page.on('response', async (res) => {
  if (!res.url().includes('/bryge/api/grafana/')) {
    return;
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* not json */
  }
  calls.push({ path: res.url().split('/bryge/api/grafana/')[1].split('?')[0], status: res.status(), body });
});

const fail = [];
const check = (ok, label, detail = '') => {
  console.log(`${ok ? ' ok ' : 'FAIL'} ${label}${detail ? ' | ' + detail : ''}`);
  if (!ok) {
    fail.push(label);
  }
};

async function login() {
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
}

await login();

// 1. enable the app
await page.goto(`${BASE}/plugins/bryge-ask-app`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4000);
const enable = page.getByRole('button', { name: /^Enable$/ }).first();
if (await enable.isVisible().catch(() => false)) {
  await enable.click();
  await page.waitForTimeout(4000);
}
check(
  !(await page.getByRole('button', { name: /^Enable$/ }).first().isVisible().catch(() => false)),
  'app enabled from the plugin page'
);
await page.screenshot({ path: `${OUT}/install-1-enabled.png` });

// 2. the configuration page connects itself — there is no URL or key to type
await page.goto(`${BASE}/plugins/bryge-ask-app?page=configuration`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(12000);
const configText = await page.locator('body').innerText();
check(/Add Bryge to a dashboard/.test(configText), 'configuration page rendered');
check(/Connected to Bryge as/.test(configText), 'connected to Bryge with no credentials typed',
      configText.match(/Connected to Bryge as [^.]+\./)?.[0] ?? '');
check(!/Bryge API URL/.test(configText), 'no API URL field shown');
check(!/bk_/.test(configText), 'no API key field shown');
check(
  await page.getByText('Select a dashboard').first().isVisible().catch(() => false),
  'dashboard dropdown offered after connecting'
);
// Drive the Select from the keyboard throughout. Grafana's Select renders an overlay
// that sits above both its own control and its options, so every click on either is
// intercepted; focusing the combobox and typing avoids the overlay entirely.
const combo = page.getByRole('combobox').first();
await combo.focus();
await page.keyboard.type(DASHBOARD.slice(0, 10));
await page.waitForTimeout(2000);
await page.screenshot({ path: `${OUT}/install-2-dashboards.png` });
await page.keyboard.press('Enter');
await page.waitForTimeout(6000);

// 4. did it work out the database by itself?
const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
check(body.includes(`Found ${EXPECT_SOURCE}`), "detected the dashboard's own database", EXPECT_SOURCE);
check(body.includes(EXPECT_USER), 'read the credentials off the Grafana data source', EXPECT_USER);
check(body.includes(EXPECT_TABLE), 'scoped to the tables the dashboard queries', EXPECT_TABLE);
await page.screenshot({ path: `${OUT}/install-3-detected.png` });

// 5. install
// The secret field is labelled per engine — "Database password" for SQL engines,
// "InfluxDB API token" for Influx — so fill whichever one this dashboard produced.
const secretField = page.locator('input[type="password"]').first();
await secretField.fill(DB_PASSWORD);
await page.getByRole('button', { name: /Add Bryge to this dashboard/ }).click();
await page
  .waitForSelector('text=/is ready/', { timeout: 600000 })
  .catch(() => {});
const done = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
check(/is ready/.test(done), 'install completed', done.match(/Bryge found [^.]+\./)?.[0] ?? '');
const onboarded = calls.find((c) => c.path === 'onboard');
check(onboarded?.status === 200, 'onboard call succeeded', JSON.stringify(onboarded?.body ?? {}));
await page.screenshot({ path: `${OUT}/install-4-done.png` });

// 6. the dashboard itself
await page.goto(`${BASE}/d/${DASH_UID}?from=now-30m&to=now`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(15000);
const card = page.getByTestId('data-testid Panel header Ask Bryge');
check(await card.isVisible().catch(() => false), 'chat card was added to the dashboard');

const PANEL = MENU_PANEL;
const header = page.getByTestId(`data-testid Panel header ${PANEL}`);
await header.hover();
await page.getByTestId(`data-testid Panel menu ${PANEL}`).click({ timeout: 15000 });
await page.waitForTimeout(1500);
let ask = page.getByRole('menuitem', { name: /Ask Bryge/ }).first();
if (!(await ask.isVisible().catch(() => false))) {
  const more = page.getByRole('menuitem', { name: /More/ }).first();
  if (await more.isVisible().catch(() => false)) {
    await more.hover();
    await page.waitForTimeout(1000);
    ask = page.getByRole('menuitem', { name: /Ask Bryge/ }).first();
  }
}
check(await ask.isVisible().catch(() => false), '"Ask Bryge" on a plain SQL panel');
await page.screenshot({ path: `${OUT}/install-5-dashboard.png` });

// and it actually answers, bound to the database this dashboard was set up with
if (await ask.isVisible().catch(() => false)) {
  await ask.click();
  await page.waitForTimeout(2500);
  const before = calls.length;
  const suggestion = page.getByRole('button', { name: /What stands out/ }).first();
  if (await suggestion.isVisible().catch(() => false)) {
    await suggestion.click();
    await page
      .waitForFunction(() => !document.body.innerText.includes('Bryge is reading your data…'), null, {
        timeout: 240000,
      })
      .catch(() => {});
    await page.waitForTimeout(4000);
    const asked = calls.slice(before).find((c) => c.path === 'query');
    check(asked?.status === 200, 'menu question answered', (asked?.body?.answer ?? '').slice(0, 110));
    check((asked?.body?.frame?.row_count ?? 0) > 0, 'answer came with data', String(asked?.body?.frame?.row_count));
  } else {
    check(false, 'modal offered a suggested question');
  }
  await page.screenshot({ path: `${OUT}/install-6-answered.png` });
}

console.log(fail.length ? `\n${fail.length} check(s) failed: ${fail.join('; ')}` : '\ninstall flow fully working');
await browser.close();
process.exit(fail.length ? 1 : 0);
