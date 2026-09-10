const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    for (const width of [1000, 360]) {
      for (const fixture of ['membership-purchase', 'account-return']) {
        const page = await browser.newPage({ viewport: { width, height: 1000 } });
        page.on('pageerror', error => console.log('PAGE ERROR:', error.message));
        await page.goto(`http://127.0.0.1:5178/tests/browser/${fixture}.html`);
        await page.waitForFunction(() => /^(PASS|FAIL):/.test(document.getElementById('results')?.textContent ?? ''));
        const result = await page.locator('#results').innerText();
        console.log(fixture, width, result);
        if (result.startsWith('FAIL')) process.exitCode = 1;
        if (fixture === 'membership-purchase') {
          await page.locator('#app').screenshot({ path: `/private/tmp/festival-purchase-${width}.png` });
          const overflow = await page.locator('#app').evaluate(element => element.scrollWidth > element.clientWidth);
          console.log('horizontalOverflow', overflow);
          if (overflow) process.exitCode = 1;
        }
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
