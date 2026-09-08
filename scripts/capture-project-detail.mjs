// Explicit capture; never invoked by runtime/build.
import {readFile,writeFile,copyFile} from 'node:fs/promises';
import {basename} from 'node:path';
import {parseHTML} from 'linkedom';
const d=parseHTML(await readFile('参考文件/项目详细.html','utf8')).document;
const main=d.querySelector('main').cloneNode(true);
for(const e of main.querySelectorAll('script'))e.remove();
// Personal reference text is not part of the frozen component package.
main.querySelector('[name=project-title]').textContent='项目';
main.querySelector('[name=project-title]').setAttribute('aria-label','项目标题');
for(const e of main.querySelectorAll('[placeholder],[data-placeholder],[aria-label]'))for(const attr of ['placeholder','data-placeholder','aria-label'])if(e.hasAttribute(attr))e.setAttribute(attr,e.getAttribute(attr).replaceAll('cai','项目'));
const list=main.querySelector('ol'),row=list.firstElementChild;
list.replaceChildren(row);row.querySelector('a').href='#';row.querySelector('a').removeAttribute('aria-description');
row.querySelector('a .font-medium').textContent='会话标题';row.querySelector('a .text-token-text-secondary').textContent='会话摘要';row.querySelector('[data-testid=project-conversation-overflow-date]').textContent='';
const b=row.querySelector('button');b.removeAttribute('data-conversation-options-trigger');b.setAttribute('aria-label','对话选项');
const stylesheets=[];
for(const l of d.querySelectorAll('link[rel=stylesheet]')){const h=l.getAttribute('href');if(!h.startsWith('./'))continue;const name=basename(h);const data=await readFile('参考文件/'+h);let existing;try{existing=await readFile('official-templates/assets/'+name)}catch{}const dest=existing&&!existing.equals(data)?'project-detail-'+name:name;await copyFile('参考文件/'+h,'official-templates/assets/'+dest);stylesheets.push(dest)}
await writeFile('official-templates/project-detail.json',JSON.stringify({main:main.outerHTML,stylesheets},null,2)+'\n');
