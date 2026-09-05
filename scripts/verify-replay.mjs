import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseHTML } from 'linkedom';

const replayPath = resolve("replay/index.html");
const html = await readFile(replayPath, "utf8");
const document = parseHTML(html).document;
const chart = document.querySelector('.chart-widget-container');

const count = (needle) => html.split(needle).length - 1;
const assertions = [
  [count("data-file-citation-primary-file-id") > 0, "official file citation chips were not rendered"],
  [count("webpage-citation-pill") > 0, "official web source pills were not rendered"],
  [!html.includes('ceobe-file-citation') && !html.includes('ceobe-source-pill'), "approximate citation styles remain"],
  [count("chart-widget-container") > 0, "structured chart was not rendered"],
  [!html.includes("\uE200"), "an unparsed private-use marker remains"],
  [!html.includes("genui{"), "raw genui payload leaked into visible output"],
  [chart?.querySelectorAll('.recharts-bar-rectangle path').length === 3, 'chart SVG bars were swallowed during serialization'],
  [!chart?.querySelector('svg title')?.textContent.includes('<'), 'SVG title contains escaped plot markup'],
  [!document.body.textContent.includes('尚未接入的内容类型：model_editable_context'), 'internal context leaked into reader'],
  [![...document.querySelectorAll('summary')].some(n => ['工具记录', '活动记录'].includes(n.textContent)), 'internal records leaked into reader'],
  [document.querySelector('[data-ceobe-file-state="missing"]')?.textContent.includes('2025美亚团体赛_分值分析结果.xlsx'), 'generated file card missing'],
  [!document.querySelector('a[href^="sandbox:"]'), 'unresolved sandbox link remains actionable'],
  [!document.body.textContent.includes('附件尚未关联本地资源：下载分析结果 Excel'), 'generated file duplicated as an unresolved note'],
];

for (const [passed, message] of assertions) {
  if (!passed) throw new Error(`Replay verification failed: ${message}`);
}

console.log([
  "Replay verification passed.",
  `${count("data-file-citation-primary-file-id")} official file citation markers found.`,
  `${count("webpage-citation-pill")} official web source markers found.`,
  `${count("chart-widget-container")} chart containers found.`,
].join("\n"));
