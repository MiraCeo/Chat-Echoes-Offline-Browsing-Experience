/**
 * Export one conversation to PDF without browser print chrome.
 *
 * The app has no PDF button: a PDF normally comes from Ctrl+P, which inherits the browser's
 * header/footer (that is where "127.0.0.1:5173/..." came from). This renders the page in headless
 * Edge with displayHeaderFooter off, so the sheet carries the conversation only.
 *
 * Usage: node scripts/export-conversation-pdf.mjs --id <conversation-id> [--base URL] [--out FILE]
 */
import { chromium } from 'playwright';
import { mkdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const projectRoot = import.meta.dirname.replace(/[\\/]scripts$/, '');
const { values } = parseArgs({ options: { id: { type: 'string' }, base: { type: 'string' }, out: { type: 'string' } } });
if (!values.id) {
  console.error('Usage: node scripts/export-conversation-pdf.mjs --id <conversation-id> [--base URL] [--out FILE]');
  process.exitCode = 2;
} else {
  const base = (values.base || 'http://127.0.0.1:5173').replace(/\/$/, '');
  const out = resolve(values.out || join(projectRoot, 'data', 'private', 'pdf', `${values.id}.pdf`));
  await mkdir(dirname(out), { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CEOBE_BROWSER_CHANNEL ? { channel: process.env.CEOBE_BROWSER_CHANNEL } : process.platform === 'win32' ? { channel: 'msedge' } : {}),
  });
  try {
    const page = await browser.newPage();
    const response = await page.goto(`${base}/conversations/${values.id}.html`, { waitUntil: 'networkidle', timeout: 30000 });
    if (!response || !response.ok()) throw new Error(`页面不可用（HTTP ${response ? response.status() : 'no response'}）：请先运行 npm run dev`);
    await page.emulateMedia({ media: 'print' });
    await page.waitForTimeout(300);
    await page.pdf({
      path: out,
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: false,
      margin: { top: '16mm', bottom: '16mm', left: '14mm', right: '14mm' },
    });
    const size = await stat(out);
    console.log(`${out} (${Math.round(size.size / 1024)} KB)`);
  } finally {
    await browser.close();
  }
}