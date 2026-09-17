import {readFile,writeFile,copyFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {parseHTML} from 'linkedom';
import {htmlSafeSvg} from './serialize-html.mjs';
export async function buildChatMenu(root,library){
 const base=join(root,'replay'),f=JSON.parse(await readFile(join(root,'official-templates/chat-menu.json'),'utf8'));
 if(f.version!==2)throw new Error('The full official chat-menu capture is required');
 const assets={};const filenameCode=await readFile(join(root,'scripts/markdown-filename.js'),'utf8'),filenameAsset='markdown-filename.'+createHash('sha256').update(filenameCode).digest('hex').slice(0,12)+'.js';await writeFile(join(base,filenameAsset),filenameCode);
   const exportCode=(await readFile(join(root,'scripts/export-download.js'),'utf8')).replace("'./markdown-filename.js'","'./"+filenameAsset+"'"),exportAsset='export-download.'+createHash('sha256').update(exportCode).digest('hex').slice(0,12)+'.js';await writeFile(join(base,exportAsset),exportCode);await writeFile(join(base,'export-download.js'),exportCode);
  for(const name of ['chat-menu.js','chat-menu.css']){let data=await readFile(join(root,'scripts',name),'utf8');if(name==='chat-menu.js')data=data.replace("'./export-download.js'","'./"+exportAsset+"'");await writeFile(join(base,name),data);assets[name]=name+'?v='+createHash('sha256').update(data).digest('hex').slice(0,12)}
 for(const file of f.stylesheets)await copyFile(join(root,'official-templates/assets',file),join(base,'assets',file));
 const icons=JSON.parse(await readFile(join(root,'official-templates/new-project.json'),'utf8')).icons;
 const pages=(await readdir(base)).filter(p=>p.endsWith('.html')).concat((await readdir(join(base,'conversations'))).filter(p=>p.endsWith('.html')).map(p=>'conversations/'+p));
 for(const page of pages){
  const prefix=page.startsWith('conversations/')?'../':'./',d=parseHTML(await readFile(join(base,page),'utf8')).document;
  // Make postprocessing repeatable without accumulating wrappers or scripts.
  for(const e of d.querySelectorAll('[data-ceobe-chat-wrapper],#ceobe-chat-project-row,#ceobe-chat-icon-bank,#ceobe-chat-status,#ceobe-chat-layout,script[src*="chat-menu.js"],link[href*="chat-menu.css"]'))e.remove();
  for(const a of d.querySelectorAll('a[data-sidebar-item]')){
   const entry=library.conversations.find(e=>(a.getAttribute('href')||'').endsWith('/'+e.id+'.html'));if(!entry)continue;
   const b=a.querySelector('[data-conversation-options-trigger]');if(!b)continue;
   // Captured pin badges do not represent local state. Do not invent pin behavior.
   for(const pin of a.querySelectorAll('button:not([data-conversation-options-trigger])'))pin.remove();
   b.dataset.ceobeChatId=entry.id;b.dataset.conversationOptionsTrigger=entry.id;b.setAttribute('aria-label',`打开“${entry.title}”的对话选项`);
   b.tabIndex=0;b.removeAttribute('disabled');b.removeAttribute('aria-disabled');b.setAttribute('aria-controls','ceobe-chat-menu');
  }
  const wrappers=f.layouts.map((l,i)=>{const w=parseHTML(l.wrapper).document.querySelector('[data-radix-popper-content-wrapper]');w.dataset.ceobeChatWrapper=String(i);w.hidden=true;return w});
  const [main,sub]=wrappers.map(w=>w.querySelector('[role=menu]'));
  main.id='ceobe-chat-menu';sub.id='ceobe-chat-submenu';main.dataset.ceobeChatMenu='';sub.dataset.ceobeChatSubmenu='';
  for(const m of [main,sub]){m.hidden=true;m.removeAttribute('aria-labelledby');m.setAttribute('data-state','closed');for(const e of m.querySelectorAll('[id]'))e.removeAttribute('id')}
  const actions=['share','rename','pin','archive','delete','move'];
  [...main.querySelectorAll('[role=menuitem]')].forEach((e,i)=>{e.dataset.chatAction=actions[i];e.tabIndex=-1;
   if(actions[i]==='move'){e.id='ceobe-chat-move';e.setAttribute('aria-controls',sub.id);e.setAttribute('aria-expanded','false');e.dataset.state='closed'}
   else e.title='此操作暂未接入本地归档';
  });sub.setAttribute('aria-labelledby','ceobe-chat-move');
  main.querySelector('[data-chat-action=archive]').remove();
   const exportItem=main.querySelector('[data-chat-action=share]');exportItem.dataset.chatAction='export-md';exportItem.title='另存为纯文本 Markdown（不含附件）';for(const e of [exportItem,...exportItem.querySelectorAll('*')])for(const n of e.childNodes)if(n.nodeType===3&&n.textContent.trim()==='分享')n.textContent='另存为 MD';
  // “打开本地文件夹” sits next to the MD export: the official row markup with the official shell “desktop” glyph (the folder glyph already means “project” in this menu). Every chat has an archive folder, so the row is always shown.
  const folderItem=exportItem.cloneNode(true);folderItem.dataset.chatAction='open-folder';folderItem.title='在资源管理器中打开这条聊天的本地归档目录（需本地服务）';folderItem.removeAttribute('data-testid');
  for(const e of [folderItem,...folderItem.querySelectorAll('*')])for(const n of e.childNodes)if(n.nodeType===3&&n.textContent.trim()==='另存为 MD')n.textContent='打开本地文件夹';
  const desktopUse=sub.querySelector('a[role=menuitem] svg use').cloneNode(true);desktopUse.setAttribute('href',desktopUse.getAttribute('href').split('#')[0]+'#desktop');const folderSvg=folderItem.querySelector('svg');folderSvg.setAttribute('viewBox','0 0 20 20');folderSvg.replaceChildren(desktopUse);exportItem.after(folderItem);
  for(const action of ['rename','pin','delete'])main.querySelector(`[data-chat-action=${action}]`).removeAttribute('title');
  // Preserve BOTH official inner wrappers and the per-project wrappers/separator.
  const create=sub.querySelector('[role=menuitem]'),list=create.parentElement;
  create.dataset.chatNewProject='';create.tabIndex=-1;list.dataset.chatProjectList='';
  const row=sub.querySelector('a[role=menuitem]').parentElement.cloneNode(true);
  row.dataset.chatProjectContainer='';row.querySelector('a').removeAttribute('href');row.querySelector('a').removeAttribute('data-discover');row.querySelector('.truncate').textContent='';
  const tpl=d.createElement('template');tpl.id='ceobe-chat-project-row';tpl.innerHTML=row.outerHTML;
  for(const child of [...list.children])if(child!==create)child.remove();
  d.body.append(...wrappers,tpl);
  const remap=use=>{const href=use.getAttribute('href');use.setAttribute('href',prefix+'cdn/assets/'+(href.includes('sprites-shell')?'sprites-shell-097001e7.svg':'sprites-core-26c3f2d4.svg')+'#'+href.split('#')[1])};
  for(const w of wrappers)for(const use of w.querySelectorAll('use'))remap(use);
  const bank=d.createElement('div');bank.hidden=true;bank.id='ceobe-chat-icon-bank';
  for(const [name,item]of Object.entries(icons)){const node=parseHTML(item.svg).document.querySelector('svg');node.dataset.chatIcon=name;remap(node.querySelector('use'));bank.append(node)}d.body.append(bank);
  const layout=d.createElement('script');layout.id='ceobe-chat-layout';layout.type='application/json';layout.textContent=JSON.stringify(f.layouts.map(l=>({offset:l.offset,side:l.side,align:l.align})));d.body.append(layout);
  const status=d.createElement('div');status.id='ceobe-chat-status';status.setAttribute('role','status');status.hidden=true;d.body.append(status);
  for(const file of f.stylesheets){if([...d.querySelectorAll('link[rel=stylesheet]')].some(e=>e.getAttribute('href')===prefix+'assets/'+file))continue;const l=d.createElement('link');l.rel='stylesheet';l.href=prefix+'assets/'+file;d.head.append(l)}
  const css=d.createElement('link');css.rel='stylesheet';css.href=prefix+assets['chat-menu.css'];d.head.append(css);
  const js=d.createElement('script');js.type='module';js.src=prefix+assets['chat-menu.js'];d.body.append(js);
  await writeFile(join(base,page),'<!DOCTYPE html>\n'+htmlSafeSvg(d.documentElement.outerHTML));
 }
 console.log('Complete official chat-menu DOM wired on',pages.length,'pages.');
}
