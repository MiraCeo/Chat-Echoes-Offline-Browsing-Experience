// Explicit reference capture only; normal builds use the frozen template.
import {readFile,writeFile} from 'node:fs/promises';
import {parseHTML} from 'linkedom';
const d=parseHTML(await readFile('参考文件/项目详细.html','utf8')).document;
const a=[...d.querySelectorAll('a[data-sidebar-item]')].find(e=>e.getAttribute('aria-label')?.includes(' — 项目 '));
const label=a?.querySelector('span.text-token-text-tertiary.text-xs');if(!label)throw new Error('Missing official project-name label');
const block=label.parentElement.cloneNode(true);block.querySelector('._NCija_content').textContent='';block.lastElementChild.textContent='';block.querySelector('[data-marquee-overflowing]')?.removeAttribute('data-marquee-overflowing');
await writeFile('official-templates/sidebar-project-label.json',JSON.stringify({block:block.outerHTML},null,2)+'\n');
