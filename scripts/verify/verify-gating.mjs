/**
 * The panel menu must only offer "Ask Bryge" on dashboards that have been set up.
 *
 * Checks both directions: absent before setup, present after. The negative case is the
 * one that matters — an item that shows up on every dashboard in someone's Grafana,
 * including ones Bryge has never seen, is noise in another team's workspace.
 */
import { chromium } from 'playwright';

const BASE = process.env.GRAFANA || 'http://192.168.1.36:3000';
const USER = process.env.GF_USER || 'admin';
const PASS = process.env.GF_PASS || 'admin';
const DASH = process.env.DASH || '/d/bryge-plant-energy';
const PANEL = process.env.PANEL || 'Phase voltages';
const EXPECT = process.env.EXPECT === 'present' ? 'present' : 'absent';

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1100 } })).newPage();

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

await page.goto(`${BASE}${DASH}?from=now-6h&to=now`, { waitUntil: 'domcontentloaded' });
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

const ok = EXPECT === 'present' ? visible : !visible;
console.log(
  `${ok ? ' ok ' : 'FAIL'} "Ask Bryge" is ${visible ? 'present' : 'absent'} in the panel menu (expected ${EXPECT})`
);
await browser.close();
process.exit(ok ? 0 : 1);
