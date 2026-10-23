// 共享页面缓存：多个构建步骤原本各自「读文件 → parseHTML → 改 → 写回」，
// 同一张页面在一次构建里会被解析/序列化多遍。合并后只解析一次、最后统一写盘。
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseHTML } from 'linkedom';
import { htmlSafeSvg } from './serialize-html.mjs';

export function createPageCache(base) {
  const documents = new Map();
  const dirty = new Set();
  return {
    async load(page) {
      if (!documents.has(page)) {
        documents.set(page, parseHTML(await readFile(join(base, page), 'utf8')).document);
      }
      return documents.get(page);
    },
    markDirty(page) { dirty.add(page); },
    async flush() {
      const written = [];
      for (const page of dirty) {
        const document = documents.get(page);
        await writeFile(join(base, page), `<!DOCTYPE html>\n${htmlSafeSvg(document.documentElement.outerHTML)}`);
        written.push(page);
      }
      dirty.clear();
      return written;
    },
    get parsedPages() { return documents.size; },
  };
}