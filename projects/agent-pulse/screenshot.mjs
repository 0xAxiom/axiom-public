import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto('http://localhost:3001', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(4000);
await page.screenshot({ path: 'docs/dashboard.png', fullPage: false });
await browser.close();
console.log('Screenshot saved to docs/dashboard.png');
