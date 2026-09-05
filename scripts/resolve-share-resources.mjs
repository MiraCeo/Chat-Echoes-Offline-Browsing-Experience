import { chromium } from 'playwright';
import { collectResources } from './archive-resources.mjs';

// Observed in the public share application's network requests. Keep this
// source-specific protocol out of the canonical schema and renderer.
export async function resolveShareResources(conversation, shareUrl) {
  const results = [];
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.CEOBE_BROWSER_CHANNEL
      ? { channel: process.env.CEOBE_BROWSER_CHANNEL } : process.platform === 'win32' ? { channel: 'msedge' } : {}) });
    // Fresh anonymous context: never read the user's browser profile/cookies.
    const context = await browser.newContext();
    const page = await context.newPage();
    const observed = new Map();
    const pending = [];
    let publicHeaders;
    page.on('response', response => {
      const url = new URL(response.url());
      const match = /^\/backend-anon\/files\/download\/(file_[\w-]+)$/.exec(url.pathname);
      if (url.origin !== 'https://chatgpt.com' || !match) return;
      const headers = response.request().headers();
      publicHeaders = Object.fromEntries(Object.entries(headers).filter(([key]) => key.startsWith('oai-') || key.startsWith('x-openai-')));
      pending.push(response.json().then(data => observed.set(match[1], { key: match[1], status: response.status(), data })).catch(() => {}));
    });
    await page.goto(shareUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(8000);
    await Promise.all(pending);
    for (const resource of collectResources(conversation)) {
      if (!/^file_[\w-]+$/.test(resource.key)) continue;
      if (observed.has(resource.key)) { results.push(observed.get(resource.key)); continue; }
      if (!publicHeaders) { results.push({ key: resource.key, error: 'Public share application did not initialize attachment requests' }); continue; }
      const url = new URL(`https://chatgpt.com/backend-anon/files/download/${resource.key}`);
      url.search = new URLSearchParams({ shared_conversation_id: new URL(shareUrl).pathname.split('/')[2], inline: 'false', download_intent: 'false' });
      try {
        const response = await context.request.get(url.href, { headers: publicHeaders, timeout: 15000, maxRedirects: 0 });
        results.push({ key: resource.key, status: response.status(), data: await response.json() });
      } catch (error) { results.push({ key: resource.key, error: error.message }); }
    }
  } catch (error) { results.push({ error: `Browser resource resolution unavailable: ${error.message}` }); }
  finally { await browser?.close(); }
  return results;
}
