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
    document: { type: 'boolean', default: false },
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
    // print.css 自带 @page 16mm/14mm 边距，在 100mm 宽的纸上会吃掉大半版心；
    // 手机配置里用更小的页边距覆盖它，同时略微收紧行高。
    await page.addStyleTag({ content: '@page{margin:5mm 5mm !important}'
      + 'body{font-size:12px !important;line-height:1.5 !important}'
      + 'h1,h2,h3{font-size:15px !important}h4,h5{font-size:13px !important}pre,code{font-size:11px !important}'
      + 'p,li,blockquote{margin-top:.3em !important;margin-bottom:.3em !important}'
      // 官方版式正文上方留有较大内边距（首页更多），手机上显得空：统一压掉。
      + 'main,body{padding-top:0 !important;margin-top:0 !important}'
      + '[class*="thread-content"],[data-testid^="conversation-turn-"]{padding-top:0 !important;margin-top:0 !important}'
      + '[class*="thread-content"]>:first-child{margin-top:0 !important;padding-top:0 !important}' });
  }
  if (options.document) {
    // 样式表被官方的高优先级类压住，直接改行内样式（带 important）最可靠。
    await page.evaluate(() => {
      const set = (node, property, value) => node.style.setProperty(property, value, 'important');
      for (const user of document.querySelectorAll('[data-message-author-role="user"]')) {
        let node = user;
        for (let depth = 0; node && depth < 6; depth += 1) {
          if ((node.getAttribute('class') || '').includes('items-end')) {
            set(node, 'align-items', 'stretch');
            for (const child of node.children) { set(child, 'width', '100%'); set(child, 'max-width', '100%'); }
            break;
          }
          node = node.parentElement;
        }
        // 气泡是消息内部那层带底色的元素（= 官方 rounded-[22px] 容器），要往下找。
        const bubble = [...user.querySelectorAll('*')].find(node => {
          const background = getComputedStyle(node).backgroundColor;
          return background && background !== 'rgba(0, 0, 0, 0)' && background !== 'rgb(255, 255, 255)';
        });
        if (bubble) {
          set(bubble, 'background', 'transparent');
          set(bubble, 'border-radius', '0');
          set(bubble, 'padding-left', '10px');
          set(bubble, 'padding-right', '0');
          set(bubble, 'border-left', '2px solid #d0d5dd');
        }
      }
      for (const selector of ['[data-testid="bookmark-button"]', 'button[aria-label*="书签"]', 'button[aria-label*="复制"]', '[data-testid="copy-turn-action-button"]']) {
        for (const node of document.querySelectorAll(selector)) set(node, 'display', 'none');
      }
    });
  }
  await page.waitForTimeout(200);
  // 页边距与 addStyleTag 里的 @page 一致；目标被阅读器占用时改写到 -v2，而不是整体失败。
  const pdfOptions = target => (options.mobile
    ? { path: target, width: '100mm', height: '178mm', printBackground: true, displayHeaderFooter: false,
        margin: { top: '5mm', bottom: '5mm', left: '5mm', right: '5mm' } }
    : { path: target, format: 'A4', printBackground: true, displayHeaderFooter: false,
        margin: { top: '16mm', bottom: '16mm', left: '14mm', right: '14mm' } });
  let finalPath = out;
  try {
    await page.pdf(pdfOptions(out));
  } catch (error) {
    if (!/EBUSY|busy|locked/i.test(`${error.code || ''} ${error.message || ''}`)) throw error;
    finalPath = out.replace(/\.pdf$/i, '-v2.pdf');
    await page.pdf(pdfOptions(finalPath));
    console.log(`目标被占用（可能在阅读器里打开），已改写到 ${finalPath}`);
  }
  const bytes = await readFile(finalPath);
  return { id, path: finalPath, skipped: false, pages: countPages(bytes), kb: Math.round(bytes.length / 1024) };
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
      : join(projectRoot, 'data', 'private', values.document ? 'pdf-document' : values.mobile ? 'pdf-mobile' : 'pdf', `${target.id}.pdf`));
    await mkdir(dirname(out), { recursive: true });
    try {
      const result = await renderOne(page, target.id, out, { force: values.force, mobile: values.mobile, document: values.document });
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