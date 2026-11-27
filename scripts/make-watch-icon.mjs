// Render the existing vector artwork on an explicit circular watch launcher plate.
// Vela's launcher does not add Android's adaptive-icon background or circular mask.
import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const source = new URL('../assets/icons/Shizhi_Windows.svg', import.meta.url);
const target = new URL('../watch/vela/src/common/logo.png', import.meta.url);
const artwork = (await readFile(source, 'utf8'))
  .replace(/<metadata>[\s\S]*?<\/metadata>/g, '')
  .replace(/<svg[^>]*>/, '')
  .replace(/<\/svg>\s*$/, '');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="192" height="192" viewBox="0 0 192 192">
<circle cx="96" cy="96" r="95" fill="#ffffff" stroke="#dce6df" stroke-width="1"/>
<svg x="34" y="34" width="124" height="124" viewBox="36.57 36.57 118.85 118.85">${artwork}</svg>
</svg>`;
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
try {
  const page = await browser.newPage({
    viewport: { width: 192, height: 192 },
    deviceScaleFactor: 1,
  });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block}</style>${svg}`,
  );
  const png = await page.screenshot({ omitBackground: true });
  await writeFile(target, png);
  console.log('Updated watch/vela/src/common/logo.png: circular white plate, transparent corners.');
} finally {
  await browser.close();
}
