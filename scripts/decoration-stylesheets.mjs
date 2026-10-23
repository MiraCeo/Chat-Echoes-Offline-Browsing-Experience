import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// 冻结模板包里各后处理步骤共用的官方样式表。
// 这些链接由步骤按顺序补进页面；重建时要先整批清掉再按同一次序补回，
// 否则它们会停留在上一趟的位置、与新补的链接交替，页面字节就不再稳定。
const STEPS = ['chat-menu', 'chat-actions', 'chat-organizer', 'sidebar-search'];

export async function decorationStylesheets(root) {
  const names = new Set();
  for (const step of STEPS) {
    try {
      const { stylesheets = [] } = JSON.parse(await readFile(join(root, 'official-templates', `${step}.json`), 'utf8'));
      for (const name of stylesheets) names.add(name);
    } catch { /* 该步骤的冻结包不存在时忽略 */ }
  }
  return names;
}
