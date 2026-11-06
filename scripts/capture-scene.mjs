import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const origin = new URL(process.argv[2] ?? 'http://127.0.0.1:4311').origin;
const directory = process.argv[3] ?? 'docs/evidence/screenshots';
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1080 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.getByText('实时连接正常', { exact: true }).waitFor();
  const stage = page.getByTestId('lab-scene');
  try {
    await page.waitForFunction(() => document.querySelector('[data-testid=lab-scene]')?.getAttribute('data-robot-asset') === 'panda-glb', {}, { timeout: 60_000 });
  } catch (error) {
    console.error(JSON.stringify({ errors, scene: await stage.evaluate((element) => ({ ...element.dataset })), assets: await page.evaluate(() => performance.getEntriesByType('resource').filter((entry) => entry.name.includes('/assets/physical/')).map((entry) => ({ file: new URL(entry.name).pathname, duration: entry.duration }))) }));
    throw error;
  }
  await page.waitForFunction(() => document.querySelector('[data-testid=lab-scene]')?.getAttribute('data-hdr') === 'ready');
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: `${directory}/physical-console.png`, fullPage: true });
  await page.getByRole('button', { name: '放大三维工作区', exact: true }).click();
  for (const [name, file] of [['全景', 'overview'], ['机器人近景', 'robot'], ['分析工位', 'analyzer'], ['电脑工位', 'computer'], ['电脑背部', 'computer-back']]) {
    await page.getByRole('button', { name, exact: true }).click();
    await page.waitForTimeout(1800);
    await page.screenshot({ path: `${directory}/physical-${file}.png` });
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ origin, errors, scene: await stage.evaluate((el) => ({ ...el.dataset })), directory }));
} finally { await browser.close(); }
