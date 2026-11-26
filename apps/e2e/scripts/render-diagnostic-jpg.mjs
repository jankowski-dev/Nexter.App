import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

const root = path.resolve(process.argv[2]);
const chartDir = path.join(root, 'chart');
const files = (await readdir(chartDir)).filter((file) => file.endsWith('.svg')).sort();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.setDefaultTimeout(120_000);
for (const file of files) {
  await page.goto(pathToFileURL(path.join(chartDir, file)).href, { waitUntil: 'load' });
  await page.screenshot({
    path: path.join(chartDir, file.replace(/\.svg$/, '.jpg')),
    type: 'jpeg',
    quality: 92,
    fullPage: false,
  });
}
await browser.close();
console.log(JSON.stringify({ rendered: files.length, dir: chartDir }));
