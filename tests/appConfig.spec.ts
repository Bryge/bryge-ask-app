import { expect, test } from './fixtures';

/**
 * What can honestly be tested without a Bryge backend: the first step of setup.
 *
 * Everything past step 1 needs a real Bryge to answer, so it belongs in
 * `scripts/verify/`, which drives a live install end to end. These cover the part every
 * installer meets first, and the part most likely to break silently, since the setup page
 * decides what to show from a health check that fails on a fresh Grafana.
 */
test.describe('setup page', () => {
  test('offers a trial and a bring-your-own-key path', async ({ appConfigPage, page }) => {
    await expect(page.getByText('Connect your Bryge account')).toBeVisible();
    await expect(page.getByText('Start a 24-hour trial')).toBeVisible();
    await expect(page.getByText('I have a Bryge API key')).toBeVisible();

    // The trial is the default, and it asks for one thing.
    await expect(page.getByPlaceholder('you@company.com')).toBeVisible();

    const start = page.getByRole('button', { name: 'Start the trial' });
    await expect(start).toBeDisabled();
    await page.getByPlaceholder('you@company.com').fill('someone@example.com');
    await expect(start).toBeEnabled();
  });

  test('the key path asks for a key and says where to get one', async ({ appConfigPage, page }) => {
    await page.getByText('I have a Bryge API key').click();

    await expect(page.getByPlaceholder('bk_…')).toBeVisible();
    await expect(page.getByRole('link', { name: /Create an API key on bryge.io/i })).toBeVisible();

    // Connect stays shut until a key is actually present.
    await expect(page.getByRole('button', { name: 'Connect' })).toBeDisabled();
    await page.getByPlaceholder('bk_…').fill('bk_not_a_real_key');
    await expect(page.getByRole('button', { name: 'Connect' })).toBeEnabled();
  });

  test('a self-hosted Bryge can change the API URL', async ({ appConfigPage, page }) => {
    await page.getByText('Self-hosted Bryge').click();
    await expect(page.getByText('Bryge API URL')).toBeVisible();
  });
});
