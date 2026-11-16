const { chromium, B, api, sleep } = require('./lib/standin.js');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 }
  });
  await context.route(B + '/**', api);
  const page = await context.newPage();

  // Login
  await page.goto('http://127.0.0.1:8500', { waitUntil: 'networkidle' });
  await page.fill('#empId', '8986');
  await page.fill('#pw', 'Secret123');
  await page.click('button[type=submit]');

  // Wait for Dashboard to mount
  await page.waitForFunction(() => /Dashboard/.test(document.body.innerText), null, { timeout: 30000 });
  await sleep(1500);

  // Take screenshot of Cross-Channel Velocity Chart area
  const chartCard = page.locator('text=Cross-Channel Daily Velocity').locator('xpath=ancestor::div[contains(@class, "rounded-")]').first();
  await chartCard.waitFor({ state: 'visible', timeout: 10000 });
  const screenshotPath = 'C:/Users/ASUS/.gemini/antigravity/brain/982ce92b-ce9a-47db-93cd-504819325ceb/verified_velocity_date_only.png';
  await chartCard.screenshot({ path: screenshotPath });
  console.log(`Saved screenshot to: ${screenshotPath}`);

  // Hover over canvas near 15% width (around Nov 4) to test tooltip
  const canvas = chartCard.locator('canvas').first();
  const box = await canvas.boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width * 0.15, box.y + box.height * 0.4);
    await sleep(400);
    const tooltipScreenshot = 'C:/Users/ASUS/.gemini/antigravity/brain/982ce92b-ce9a-47db-93cd-504819325ceb/verified_velocity_tooltip.png';
    await chartCard.screenshot({ path: tooltipScreenshot });
    console.log(`Saved tooltip screenshot to: ${tooltipScreenshot}`);
  }

  // Also verify System Health text
  await page.click('text=Settings');
  await sleep(800);
  const healthBtn = page.locator('button:has-text("System Health")').first();
  if (await healthBtn.isVisible()) {
    await healthBtn.click();
    await sleep(500);
    const text = await page.innerText('body');
    const healthMatch = text.match(/System Health[\s\S]*?(?=Errors|\n\n\n)/i);
    if (healthMatch) {
      console.log('HEALTH STATS:', healthMatch[0].slice(0, 300));
    }
  }

  await browser.close();
  console.log('DONE verification');
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
