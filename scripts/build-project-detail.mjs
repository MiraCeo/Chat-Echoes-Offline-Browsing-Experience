import {readFile,writeFile,copyFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {parseHTML} from 'linkedom';
import {htmlSafeSvg} from './serialize-html.mjs';
export async function buildProjectDetail(root,library){
 const base=join(root,'replay'),f=JSON.parse(await readFile(join(root,'official-templates/project-detail.json'),'utf8'));
 const d=parseHTML(await readFile(join(base,'projects.html'),'utf8')).document,m=parseHTML(f.main).document.querySelector('main');d.querySelector('main').replaceWith(m);
 d.body.removeAttribute('data-ceobe-projects-page');d.body.dataset.ceobeProjectDetail='';d.title='项目详情 · CEOBE';
 const list=m.querySelector('ol');list.dataset.projectConversations='';const row=list.firstElementChild.cloneNode(true);list.replaceChildren();
 const tpl=d.createElement('div');tpl.hidden=true;tpl.id='ceobe-project-conversation-row';tpl.innerHTML=row.outerHTML;d.body.append(tpl);
 const status=d.createElement('p');status.dataset.projectDetailStatus='';status.className='ceobe-project-status';status.setAttribute('role','status');list.after(status);
 for(const b of m.querySelectorAll('button')){b.type='button';b.setAttribute('aria-disabled','true');b.title='此功能暂未接入本地项目';}
 m.querySelector('[name=project-title]').removeAttribute('aria-label');
 const form=m.querySelector('form');form.dataset.ceobeImportForm='';
 for(const e of form.querySelectorAll('[popover],input[type=file],textarea'))e.remove();
 form.querySelector('[data-composer-transition-slot=leading]').replaceChildren();
 const trailing=form.querySelector('[data-composer-transition-slot=trailing]');trailing.replaceChildren();
 // Reuse the already-frozen import submit button, not the reference's voice/model controls.
 const importer=parseHTML(await readFile(join(base,'import.html'),'utf8')).document;
 const submit=importer.querySelector('[data-ceobe-import-submit]').cloneNode(true);trailing.append(submit);
 const input=form.querySelector('#prompt-textarea');input.dataset.ceobeImportInput='';input.setAttribute('contenteditable','true');input.setAttribute('aria-label','导入会话到当前项目');input.querySelector('p').setAttribute('data-placeholder','导入会话：粘贴 ChatGPT 分享链接');
 const chats=m.querySelector('[role=tab]');chats.removeAttribute('aria-disabled');chats.removeAttribute('title');chats.tabIndex=0;
 for(const [i,tab]of [...m.querySelectorAll('[role=tab]')].entries()){tab.id='project-detail-tab-'+i;tab.setAttribute('aria-controls','project-detail-panel-'+i);const panel=m.querySelectorAll('[role=tabpanel]')[i];panel.id='project-detail-panel-'+i;panel.setAttribute('aria-labelledby',tab.id)}
 const previews={};for(const c of library.conversations){try{const raw=JSON.parse(await readFile(join(root,c.conversation_path),'utf8'));const messages=(raw.linear_message_ids||[]).map(id=>raw.messages[id]).filter(m=>m?.role==='user'&&m.visible!==false);const last=messages.at(-1);previews[c.id]=(last?.content?.blocks||[]).filter(b=>b.type==='text').map(b=>b.text).join(' ').replace(/\s+/g,' ').slice(0,500)}catch{previews[c.id]=''}}
 const data=d.createElement('script');data.id='ceobe-project-previews';data.type='application/json';data.textContent=JSON.stringify(previews).replaceAll('<','\\u003c');d.body.append(data);
 for(const use of d.querySelectorAll('main use,#ceobe-project-conversation-row use')){const h=use.getAttribute('href');use.setAttribute('href','./cdn/assets/'+(h.includes('sprites-shell')?'sprites-shell-097001e7.svg':'sprites-core-26c3f2d4.svg')+'#'+h.split('#')[1])}
 for(const name of f.stylesheets){await copyFile(join(root,'official-templates/assets',name),join(base,'assets',name));if(![...d.querySelectorAll('link[rel=stylesheet]')].some(e=>e.getAttribute('href')==='./assets/'+name)){const l=d.createElement('link');l.rel='stylesheet';l.href='./assets/'+name;d.head.append(l)}}
 for(const name of ['project-detail.js','project-detail.css']){const content=await readFile(join(root,'scripts',name));await writeFile(join(base,name),content);const e=d.createElement(name.endsWith('.js')?'script':'link'),url='./'+name+'?v='+createHash('sha256').update(content).digest('hex').slice(0,12);if(name.endsWith('.js')){e.type='module';e.src=url;d.body.append(e)}else{e.rel='stylesheet';e.href=url;d.head.append(e)}}
 await writeFile(join(base,'project.html'),'<!DOCTYPE html>\n'+htmlSafeSvg(d.documentElement.outerHTML));
}
