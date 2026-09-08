import {readFile,writeFile,copyFile} from 'node:fs/promises';import{basename}from'node:path';import{parseHTML}from'linkedom';
const load=async n=>parseHTML(await readFile('参考文件/'+n+'.html','utf8')).document;
const collapsed=await load('最近'),list=await load('整理聊天'),grouped=await load('按项目'),expanded=await load('项目展开');
const section=(d,text)=>[...d.querySelectorAll('h2')].find(h=>h.textContent===text).parentElement.parentElement.parentElement;
const listHeader=section(list,'最近').firstElementChild.cloneNode(true),closedSvg=section(collapsed,'最近').querySelector('h2').parentElement.querySelector('svg').cloneNode(true);
const projectSection=section(grouped,'项目').cloneNode(true),projectRow=projectSection.querySelector('li').cloneNode(true);projectSection.querySelector('ul').replaceChildren();
const expandedSection=section(expanded,'项目'),panel=[...expandedSection.querySelectorAll('[role=button][aria-controls]')].map(b=>expanded.getElementById(b.getAttribute('aria-controls'))).find(p=>p?.querySelector('a'));
const nested=panel.querySelector('li').cloneNode(true);const empty=[...expandedSection.querySelectorAll('li')].find(e=>e.textContent==='暂无项目聊天').cloneNode(true);
const panelShell=panel.cloneNode(true);panelShell.querySelector('ul').replaceChildren();panelShell.removeAttribute('id');projectRow.append(panelShell);
projectRow.querySelector('._NCija_content').textContent='';nested.querySelector('._NCija_content').textContent='';
for(const e of nested.querySelectorAll('a')){e.href='#';e.removeAttribute('aria-label')}for(const e of nested.querySelectorAll('button')){e.removeAttribute('data-conversation-options-trigger');e.removeAttribute('aria-label')}
const menu=list.querySelector('[role=menu]').parentElement.cloneNode(true);
const parts={listHeader:listHeader.outerHTML,closedSvg:closedSvg.outerHTML,openSvg:listHeader.querySelector('h2').parentElement.querySelector('svg').outerHTML,projectSection:projectSection.outerHTML,projectRow:projectRow.outerHTML,nested:nested.outerHTML,empty:empty.outerHTML,menu:menu.outerHTML};
const stylesheets=[];for(const d of [list,grouped,expanded])for(const l of d.querySelectorAll('link[rel=stylesheet]')){const href=l.getAttribute('href');if(!href.startsWith('./'))continue;const name=basename(href),data=await readFile('参考文件/'+href);let old;try{old=await readFile('official-templates/assets/'+name)}catch{}const dest=old&&!old.equals(data)?'organizer-'+name:name;await copyFile('参考文件/'+href,'official-templates/assets/'+dest);if(!stylesheets.includes(dest))stylesheets.push(dest)}
await writeFile('official-templates/chat-organizer.json',JSON.stringify({...parts,stylesheets},null,2)+'\n');
