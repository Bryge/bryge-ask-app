/**
 * Checks the two things a dashboard viewer actually sees:
 *   1. "Ask Bryge" in every panel's 3-dot menu, and the modal it opens
 *   2. the Bryge Chat card on the dashboard
 *
 * Asserts on the network response behind each answer, not on rendered text.
 */
import { chromium } from 'playwright';

const BASE = process.env.GRAFANA || 'http://192.168.1.36:3000';
const USER = process.env.GF_USER || 'admin';
const PASS = process.env.GF_PASS || 'admin';
const DASH = process.env.DASH || '/d/bryge-plant-energy/plant-energy-and-weather';
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

await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
await page.fill('input[name="user"]', USER);
await page.fill('input[name="password"]', PASS);
await page.click('button[type="submit"]');
// Logging in with the literal password "admin" lands on Grafana's forced
// change-password screen rather than the home page. Skip it.
await page.waitForTimeout(4000);
const skip = page.getByRole('button', { name: /^Skip$/ }).first();
if (await skip.isVisible().catch(() => false)) {
  await skip.click();
  await page.waitForTimeout(2000);
}
if (page.url().includes('/login')) {
  console.log('FAIL could not get past the login page');
  await page.screenshot({ path: `${OUT}/login-stuck.png` });
  await browser.close();
  process.exit(1);
}

await page.goto(`${BASE}${DASH}?from=now-6h&to=now`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(15000);

// ---------------------------------------------------------------- panel menu
const PANEL = process.env.PANEL || 'Phase voltages'; // an ordinary panel, nothing to do with Bryge
const header = page.getByTestId(`data-testid Panel header ${PANEL}`);
check(await header.isVisible().catch(() => false), `found the "${PANEL}" panel`);
await header.hover();
const menuButton = page.getByTestId(`data-testid Panel menu ${PANEL}`);
await menuButton.click({ timeout: 15000 });
await page.waitForTimeout(1500);

const askItem = page.getByRole('menuitem', { name: /Ask Bryge/ }).first();
let askVisible = await askItem.isVisible().catch(() => false);
if (!askVisible) {
  // Grafana groups plugin-provided items under "Extensions" in some versions.
  const more = page.getByRole('menuitem', { name: /Extensions|More/ }).first();
  if (await more.isVisible().catch(() => false)) {
    await more.hover();
    await page.waitForTimeout(1000);
    askVisible = await askItem.isVisible().catch(() => false);
  }
}
check(askVisible, 'panel menu offers "Ask Bryge" on a plain SQL panel');
await page.screenshot({ path: `${OUT}/menu-1-item.png` });

if (askVisible) {
  await askItem.click();
  await page.waitForTimeout(2500);
  const modal = page.getByRole('dialog');
  check(await modal.isVisible().catch(() => false), 'modal opened');
  check(
    (await modal.innerText().catch(() => '')).includes(PANEL),
    'modal knows which panel it was opened from'
  );
  await page.screenshot({ path: `${OUT}/menu-2-modal.png` });

  const before = calls.length;
  const suggestion = modal.getByRole('button', { name: /What stands out/ }).first();
  if (await suggestion.isVisible().catch(() => false)) {
    await suggestion.click();
  } else {
    await modal.getByPlaceholder(/Ask about/).fill('what is the average phase 1 voltage?');
    await modal.getByRole('button', { name: 'Ask', exact: true }).click();
  }
  await page.waitForFunction(() => !document.body.innerText.includes('Bryge is reading your data…'), null, {
    timeout: 180000,
  }).catch(() => {});
  await page.waitForTimeout(4000);

  const asked = calls.slice(before).find((c) => c.path === 'query');
  check(asked?.status === 200, 'modal question reached Bryge');
  check(Boolean(asked?.body?.answer), 'Bryge answered', (asked?.body?.answer ?? '').slice(0, 110));
  check((asked?.body?.frame?.row_count ?? 0) > 0, 'answer came with data', String(asked?.body?.frame?.row_count));
  await page.screenshot({ path: `${OUT}/menu-3-answered.png` });
  await page.keyboard.press('Escape');
}

// ---------------------------------------------------------------- chat card
await page.goto(`${BASE}${DASH}?from=now-6h&to=now`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(12000);
// Grafana only renders panels once they are near the viewport, and the chat card is the
// last panel on a long dashboard — so scroll to the bottom BEFORE looking for it.
await page.mouse.wheel(0, 6000);
await page.waitForTimeout(4000);
const card = page.getByTestId('data-testid Panel header Ask Bryge');
check(await card.isVisible().catch(() => false), 'Bryge Chat card is on the dashboard');
await card.scrollIntoViewIfNeeded().catch(() => {});
await page.waitForTimeout(1500);

const before2 = calls.length;
const starter = page.getByRole('button', { name: /What stands out in this data/ }).first();
if (await starter.isVisible().catch(() => false)) {
  await starter.click();
  await page.waitForFunction(() => !document.body.innerText.includes('Bryge is reading your data…'), null, {
    timeout: 180000,
  }).catch(() => {});
  await page.waitForTimeout(4000);
  const asked = calls.slice(before2).find((c) => c.path === 'query');
  check(asked?.status === 200, 'chat card question reached Bryge');
  check(Boolean(asked?.body?.answer), 'chat card got an answer', (asked?.body?.answer ?? '').slice(0, 110));
} else {
  check(false, 'chat card showed its starter question');
}
await page.screenshot({ path: `${OUT}/chat-card.png`, fullPage: true });

console.log(fail.length ? `\n${fail.length} check(s) failed: ${fail.join('; ')}` : '\npanel menu + chat card both working');
await browser.close();
process.exit(fail.length ? 1 : 0);
