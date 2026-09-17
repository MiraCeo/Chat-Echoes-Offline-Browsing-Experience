// Freeze only the measured shell and an anonymized row; no private chat content ships.
import{readFile,writeFile}from'node:fs/promises';import{parseHTML}from'linkedom';
const f=JSON.parse(await readFile('data/private/rail-recent.json','utf8')),d=parseHTML(f.menu).document,w=d.firstElementChild,m=w.querySelector('[role=menu]'),ul=m.querySelector('ul'),limit=ul.children.length,row=ul.firstElementChild.cloneNode(true);
const a=row.querySelector('a');a.setAttribute('href','#');a.removeAttribute('aria-label');a.removeAttribute('data-active');a.removeAttribute('aria-current');a.draggable=false;for(const e of row.querySelectorAll('._NCija_content'))e.textContent='';
for(const [i,b]of [...row.querySelectorAll('button')].entries()){for(const k of ['id','data-testid','data-conversation-options-trigger','aria-controls'])b.removeAttribute(k);b.setAttribute('aria-label',i===0?'置顶聊天':'聊天选项');b.dataset.railAction=i===0?'pin':'more';}
ul.replaceChildren();m.removeAttribute('id');m.removeAttribute('aria-labelledby');m.dataset.state='closed';w.hidden=true;
const data={source:'Authorized live Edge sidebar rail recent-chat menu; personal contents removed.',menu:w.outerHTML,row:row.outerHTML,limit,layout:{side:'right',align:'start',offset:{x:f.metrics.rect.x-f.anchor.x-f.anchor.width,y:f.metrics.rect.y-f.anchor.y}},metrics:f.metrics};
if(JSON.stringify(data).includes('/c/'))throw Error('Private URL escaped sanitization');await writeFile('official-templates/rail-recent.json',JSON.stringify(data,null,2));console.log('Frozen recent rail',limit,data.layout);
