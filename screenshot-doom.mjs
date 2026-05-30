import { chromium } from "@playwright/test";

async function captureScreenshot(wadName) {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  try {
    console.log(`Loading Doom${wadName}...`);
    const url = `http://127.0.0.1:8000/?wad=${wadName.toLowerCase()}`;
    console.log(`  URL: ${url}`);
    
    const response = await page.goto(url, {
      waitUntil: "load",
      timeout: 20000,
    });
    
    console.log(`  Status: ${response?.status()}`);
    
    // Wait for canvas to render
    await page.waitForTimeout(4000);
    
    const filename = `doom${wadName}-screenshot-pw.png`;
    await page.screenshot({ path: filename });
    console.log(`✓ Screenshot saved: ${filename}`);
    
  } catch (error) {
    console.error(`✗ Error capturing Doom${wadName}:`, error.message);
  } finally {
    await browser.close();
  }
}

async function main() {
  console.log("Starting Playwright screenshot capture...");
  await captureScreenshot("1");
  await captureScreenshot("2");
  console.log("Done!");
}

main();
