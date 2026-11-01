const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

const server = http.createServer((req, res) => {
  let urlPath = req.url.split('?')[0];
  let file = path.join(__dirname, 'dist', urlPath);
  if (urlPath === '/' || urlPath === '/index.html') file = path.join(__dirname, 'dist', 'index.html');
  fs.readFile(file, (err, data) => {
    if (err) {
      fs.readFile(path.join(__dirname, 'dist', 'index.html'), (e, d) => {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(d);
      });
      return;
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(8500, '127.0.0.1', async () => {
  try {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
    await page.goto('http://127.0.0.1:8500/index.html');
    await page.fill('#empId', '8986');
    await page.fill('#pw', 'Secret123');
    await page.click('button[type=submit]');
    await page.waitForTimeout(3000);

    // Click "KPI Performance" in Header
    await page.click('button:has-text("KPI Performance")');
    await page.waitForTimeout(2000);

    // Click "Branch Daily Tasks" pill
    await page.click('button:has-text("Branch Daily Tasks")');
    await page.waitForTimeout(2000);

    const thead = page.locator('thead').first();
    if (await thead.isVisible()) {
      await thead.screenshot({ path: 'test_thead_before.png' });
      console.log('Saved test_thead_before.png');

      // Now scroll the table slightly right and take another screenshot
      const scrollContainer = page.locator('.overflow-x-auto').filter({ has: page.locator('table') }).first();
      await scrollContainer.evaluate((el) => { el.scrollLeft = 120; });
      await page.waitForTimeout(500);
      await thead.screenshot({ path: 'test_thead_scrolled.png' });
      console.log('Saved test_thead_scrolled.png');
    } else {
      console.log('thead not found');
    }

    await browser.close();
  } catch (err) {
    console.error(err);
  } finally {
    server.close();
  }
});
