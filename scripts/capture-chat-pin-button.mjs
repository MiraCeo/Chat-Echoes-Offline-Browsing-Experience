// Explicit reference capture only; ordinary builds never read the reference folder.
import {readFile,writeFile} from 'node:fs/promises';
import {parseHTML} from 'linkedom';
const d=parseHTML(await readFile('参考文件/置顶按钮.html','utf8')).document;
const b=d.querySelector('button[data-trailing-button][aria-label^="置顶 "]');
if(!b||b.querySelector('use')?.getAttribute('href').split('#')[1]!=='pin-sm')throw new Error('Missing official pin button');
b.setAttribute('aria-label','置顶');
await writeFile('official-templates/chat-pin-button.json',JSON.stringify({button:b.outerHTML},null,2)+'\n');
