/**
 * Export conversations to PDF without browser print chrome.
 *
 * The app has no PDF button: a PDF normally comes from Ctrl+P, which inherits the browser's
 * header/footer (that is where "127.0.0.1:5173/..." came from). This renders pages in headless
 * Edge with displayHeaderFooter off, so the sheet carries the conversation only.
 *
 * Usage:
 *   node scripts/export-conversation-pdf.mjs --id <conversation-id> [--base URL] [--out FILE] [--force]
 *   node scripts/export-conversation-pdf.mjs --all [--limit N] [--force]
 */
import { chromium } from 'playwright';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const projectRoot = import.meta.dirname.replace(/[\\/]scripts$/, '');
const { values } = parseArgs({
  options: {
    id: { type: 'string' },
    all: { type: 'boolean', default: false },
    limit: { type: 'string' },
    base: { type: 'string' },
    out: { type: 'string' },
    force: { type: 'boolean', default: false },
    mobile: { type: 'boolean', default: false },
  },
});

const base = (values.base || 'http://127.0.0.1:5173').replace(/\/$/, '');
const excludeIds = [];
const countPages = bytes => {
  const text = bytes.toString('latin1');
  return (text.match(/\/Type\s*\/Page[^s]/g) || []).length;
};

const renderOne = async (page, id, out, options) => {
  if (!options.force) {
    try {
      const existing = await stat(out);
      if (existing.size > 0) {
        const bytes = await readFile(out);
        return { id, skipped: true, pages: countPages(bytes), kb: Math.round(existing.size / 1024) };
      }
    } catch { /* not there yet */ }
  }
  const response = await page.goto(`${base}/conversations/${id}.html`, { waitUntil: 'networkidle', timeout: 60000 });
  if (!response || !response.ok()) throw new Error(`页面不可用（HTTP ${response ? response.status() : 'no response'}）：请先运行 npm run dev`);
  await page.emulateMedia({ media: 'print' });
  if (options.mobile) {
    await page.addStyleTag({ content: 'body{font-size:12px !important;line-height:1.55 !important}'
      + 'h1,h2,h3{font-size:15px !important}h4,h5{font-size:13px !important}pre,code{font-size:11px !important}' });
  }
  await page.waitForTimeout(200);
  await page.pdf(options.mobile
    ? {
        path: out, width: '100mm', height: '178mm', printBackground: true, displayHeaderFooter: false,
        margin: { top: '6mm', bottom: '6mm', left: '6mm', right: '6mm' },
      }
    : {
        path: out, format: 'A4', printBackground: true, displayHeaderFooter: false,
        margin: { top: '16mm', bottom: '16mm', left: '14mm', right: '14mm' },
      });
  const bytes = await readFile(out);
  return { id, skipped: false, pages: countPages(bytes), kb: Math.round(bytes.length / 1024) };
};

let targets;
if (values.all) {
  const library = JSON.parse(await readFile(join(projectRoot, 'archive', 'library.ceobe.json'), 'utf8'));
  targets = library.conversations.map(entry => ({ id: entry.id, title: entry.title }));
  if (values.limit) targets = targets.slice(0, Number(values.limit));
} else if (values.id) {
  targets = [{ id: values.id, title: null }];
} else {
  console.error('Usage: node scripts/export-conversation-pdf.mjs (--id <id> | --all [--limit N]) [--force]');
  process.exit(2);
}

const browser = await chromium.launch({
  headless: true,
  ...(process.env.CEOBE_BROWSER_CHANNEL ? { channel: process.env.CEOBE_BROWSER_CHANNEL } : process.platform === 'win32' ? { channel: 'msedge' } : {}),
});
const results = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', error => excludeIds.push(`${targets[results.length]?.id}: ${error.message}`));
  for (const target of targets) {
    const out = resolve(targets.length === 1 && values.out
      ? values.out
      : join(projectRoot, 'data', 'private', values.mobile ? 'pdf-mobile' : 'pdf', `${target.id}.pdf`));
    await mkdir(dirname(out), { recursive: true });
    try {
      const result = await renderOne(page, target.id, out, { force: values.force, mobile: values.mobile });
      results.push({ ...result, title: target.title });
      console.log(`${result.skipped ? 'skip' : 'pdf '} ${target.id.slice(0, 8)}  ${String(result.pages).padStart(4)} 页  ${String(result.kb).padStart(6)} KB  ${target.title || ''}`);
    } catch (error) {
      results.push({ id: target.id, title: target.title, error: error.message.split('\n')[0] });
      console.log(`FAIL ${target.id.slice(0, 8)}  ${error.message.split('\n')[0]}`);
    }
  }
} finally {
  await browser.close();
}

if (results.length > 1) {
  const pages = results.reduce((sum, item) => sum + (item.pages || 0), 0);
  const kb = results.reduce((sum, item) => sum + (item.kb || 0), 0);
  const failed = results.filter(item => item.error).length;
  console.log(`\n共 ${results.length} 条：${results.length - failed - results.filter(item => item.skipped).length} 新导出、`
    + `${results.filter(item => item.skipped).length} 跳过、${failed} 失败；${pages} 页，${(kb / 1024).toFixed(1)} MB`);
  if (failed) process.exitCode = 1;
}