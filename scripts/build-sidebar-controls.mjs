import{readFile,writeFile,readdir,copyFile}from'node:fs/promises';import{join}from'node:path';import{createHash}from'node:crypto';import{parseHTML}from'linkedom';import{htmlSafeSvg}from'./serialize-html.mjs';import{ensureStylesheet,placeStylesheet,placeScript}from'./page-decoration.mjs';
export async function buildSidebarControls(root,pageCache=null,selected=null){
 const base=join(root,'replay'),f=JSON.parse(await readFile(join(root,'official-templates/sidebar-search.json'),'utf8')),files={};
 // linkedom 按插入顺序序列化属性；先删再设，保证每次重建的属性顺序一致（否则同一页两次构建字节不同）。
 const setAttrs=(node,attrs)=>{for(const [name,value]of Object.entries(attrs)){node.removeAttribute(name);if(value!==null)node.setAttribute(name,String(value))}};
 // linkedom serializes <template> from its light children, not template.content; write mutated content back so href rewrites and added nodes reach the page.
 const syncTemplate=t=>{t.innerHTML=[...t.content.childNodes].map(n=>n.nodeType===1?n.outerHTML:n.textContent).join('')};
 for(const name of ['sidebar-controls.css']){const code=await readFile(join(root,'scripts',name));files[name]=name.replace(/\.(js|css)$/,(ext)=>'.'+createHash('sha256').update(code).digest('hex').slice(0,12)+ext);await writeFile(join(base,files[name]),code)}
 // 搜索语法是独立模块（Node 测试与浏览器共用）。浏览器按相对路径 import，所以这里按内容哈希落盘，
 // 并把主脚本里的说明符改成哈希名；页面路径不参与解析，会话页与顶层页都能加载。
 const querySource=await readFile(join(root,'scripts/search-query.mjs'),'utf8'),queryName='search-query.'+createHash('sha256').update(querySource).digest('hex').slice(0,12)+'.mjs';
 await writeFile(join(base,queryName),querySource);
 const controlsSource=(await readFile(join(root,'scripts/sidebar-controls.js'),'utf8')).replace("'./search-query.mjs'","'./"+queryName+"'");
 if(!controlsSource.includes("'./"+queryName+"'"))throw new Error('sidebar-controls.js 没有引用 search-query.mjs');
 files['sidebar-controls.js']='sidebar-controls.'+createHash('sha256').update(controlsSource).digest('hex').slice(0,12)+'.js';
 await writeFile(join(base,files['sidebar-controls.js']),controlsSource);
 for(const name of f.stylesheets)await copyFile(join(root,'official-templates/assets',name),join(base,'assets',name));
 const pages=selected??(await readdir(base)).filter(n=>n.endsWith('.html')).concat((await readdir(join(base,'conversations'))).filter(n=>n.endsWith('.html')).map(n=>'conversations/'+n));
 for(const page of pages){
  const d=pageCache?await pageCache.load(page):parseHTML(await readFile(join(base,page),'utf8')).document,sidebar=d.getElementById('stage-slideover-sidebar');if(!sidebar)continue;
  // 幂等：先清掉本步骤上一次注入的节点、启动脚本与标记属性。
  for(const sel of ['[data-ceobe-rail-recent]','#ceobe-rail-recent-row','[data-ceobe-search]','#ceobe-search-row','#ceobe-search-body-row','#ceobe-search-empty'])for(const n of d.querySelectorAll(sel))n.remove();
  for(const n of d.querySelectorAll('script'))if((n.textContent||'').includes('ceobeSidebarCollapsed'))n.remove();
  for(const a of ['data-ceobe-sidebar-panel','data-ceobe-recent-trigger','data-ceobe-sidebar-toggle','data-ceobe-search-trigger','data-ceobe-project-new'])for(const n of d.querySelectorAll('['+a+']'))n.removeAttribute(a);const prefix=page.startsWith('conversations/')?'../':'./',rail=d.getElementById('stage-sidebar-tiny-bar');
  rail.nextElementSibling.dataset.ceobeSidebarPanel='';
  const recentRef=JSON.parse(await readFile(join(root,'official-templates/rail-recent.json'),'utf8'));
  const recentPopup=parseHTML(recentRef.menu).document.firstElementChild;recentPopup.dataset.ceobeRailRecent='';recentPopup.dataset.layout=JSON.stringify(recentRef.layout);recentPopup.dataset.limit=String(recentRef.limit);recentPopup.hidden=true;recentPopup.querySelector('[role=menu]').id='ceobe-rail-recent-menu';recentPopup.querySelector('[role=menu]').setAttribute('aria-label','最近聊天');d.body.append(recentPopup);
  const recentRow=d.createElement('template');recentRow.id='ceobe-rail-recent-row';recentRow.innerHTML=recentRef.row;for(const use of recentRow.content.querySelectorAll('use')){const href=use.getAttribute('href');use.setAttribute('href',prefix+'cdn/assets/sprites-shell-097001e7.svg#'+href.split('#')[1])}syncTemplate(recentRow);d.body.append(recentRow);
  const recentTrigger=[...rail.querySelectorAll('button')].find(b=>b.textContent.trim()==='最近聊天');if(recentTrigger){setAttrs(recentTrigger,{'data-ceobe-recent-trigger':'',id:'ceobe-rail-recent-trigger',tabindex:0,'aria-label':'最近聊天','aria-controls':'ceobe-rail-recent-menu','aria-expanded':'false'});recentPopup.querySelector('[role=menu]').setAttribute('aria-labelledby',recentTrigger.id)}
  for(const b of sidebar.querySelectorAll('button')){const name=b.getAttribute('aria-label')||b.textContent.trim();if(/^(打开|关闭)侧边栏$/.test(name)){setAttrs(b,{'data-ceobe-sidebar-toggle':name.startsWith('打开')?'open':'close',tabindex:0,'aria-keyshortcuts':'Control+Shift+S',title:name+' (Ctrl+Shift+S)'})}else if(['搜索','搜索聊天'].includes(name)){setAttrs(b,{'data-ceobe-search-trigger':'',tabindex:0,'aria-label':'搜索聊天','aria-haspopup':'dialog','aria-keyshortcuts':'Control+K',title:'搜索聊天 (Ctrl+K)'})}}
  for(const b of sidebar.querySelectorAll('button[aria-label="新项目"]'))if(!b.closest('[data-organizer-projects]')){setAttrs(b,{'data-ceobe-project-new':'',tabindex:0,disabled:null,'aria-disabled':null,title:null,'aria-haspopup':'dialog','aria-controls':'ceobe-create-project'})}
  for(const a of d.querySelectorAll('[data-ceobe-import-share]'))setAttrs(a,{'aria-keyshortcuts':'Control+Shift+O'});
  const dialog=parseHTML(f.dialog).document.firstElementChild;dialog.dataset.ceobeSearch='';dialog.hidden=true;dialog.querySelector('h2').textContent='搜索聊天';dialog.querySelector('input').placeholder='搜索聊天标题和正文…';dialog.querySelector('input').setAttribute('aria-label','搜索聊天标题和正文');dialog.querySelector('.F_cuGW_closeButton').setAttribute('aria-label','关闭搜索聊天');
  // Body hits get their own section below the title list; hidden until a query produces message-level results.
  const titleSection=dialog.querySelector('section'),bodySection=titleSection.cloneNode(true);bodySection.dataset.ceobeSearchBody='';bodySection.hidden=true;bodySection.querySelector('h3').textContent='正文命中';bodySection.querySelector('ol').replaceChildren();titleSection.after(bodySection);
  const status=d.createElement('p');status.className='sr-only';status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.dataset.ceobeSearchStatus='';dialog.append(status);
  // 语法提示：一行放得下，说明可用字段；空结果文案由脚本按查询形态改写。
  const hint=d.createElement('p');hint.className='ceobe-search-hint';hint.dataset.ceobeSearchHint='';hint.textContent='引号短语 · -排除 · A/B 任一 · title: · from:user/gpt · has:code/table/image · created:2025-06 · messages:>20';dialog.querySelector('.F_cuGW_modalContent').insertBefore(hint,dialog.querySelector('.F_cuGW_resultsScroller'));
  d.body.append(dialog);
  for(const [id,html]of [['ceobe-search-row',f.row],['ceobe-search-body-row',f.row],['ceobe-search-empty',f.empty]]){const template=d.createElement('template');template.id=id;template.innerHTML=html;for(const use of template.content.querySelectorAll('use')){const href=use.getAttribute('href');use.setAttribute('href',prefix+'cdn/assets/'+(href.includes('sprites-shell')?'sprites-shell-097001e7.svg':'sprites-core-26c3f2d4.svg')+'#'+href.split('#')[1])}
   if(id==='ceobe-search-empty'){const box=template.content.querySelector('.F_cuGW_noResults'),text=[...box.childNodes].find(n=>n.nodeType===3&&n.textContent.trim());if(text){const span=d.createElement('span');span.dataset.ceobeSearchEmptyText='';span.textContent=text.textContent.trim();text.replaceWith(span)}}
   syncTemplate(template);d.body.append(template)}
  // Message-level rows reuse the frozen conversation row plus the official subtitle/date slots (unused by the compact title row).
  const bodyRow=d.getElementById('ceobe-search-body-row').content,bodyLink=bodyRow.querySelector('a');bodyLink.classList.remove('F_cuGW_resultRowCompact');const subtitle=d.createElement('div');subtitle.className='F_cuGW_resultSubtitle';bodyLink.querySelector('.F_cuGW_resultText').append(subtitle);const meta=d.createElement('span');meta.className='F_cuGW_resultDate';bodyLink.append(meta);syncTemplate(d.getElementById('ceobe-search-body-row'));
  for(const use of dialog.querySelectorAll('use')){const href=use.getAttribute('href');use.setAttribute('href',prefix+'cdn/assets/'+(href.includes('sprites-shell')?'sprites-shell-097001e7.svg':'sprites-core-26c3f2d4.svg')+'#'+href.split('#')[1])}
  const boot=d.createElement('script');boot.textContent="try{document.documentElement.dataset.ceobeSidebarCollapsed=localStorage.getItem('ceobe.sidebar-collapsed.v1')==='true'?'true':'false';document.documentElement.dataset.ceobePinnedCollapsed=localStorage.getItem('ceobe.pinned-expanded.v1')==='false'?'true':'false'}catch{}";d.head.prepend(boot);
  for(const name of f.stylesheets.map(n=>'assets/'+n))ensureStylesheet(d,prefix+name);
  placeStylesheet(d,'sidebar-controls.',prefix+files['sidebar-controls.css']);
  placeScript(d,'sidebar-controls.',prefix+files['sidebar-controls.js']);
  if(pageCache)pageCache.markDirty(page);else await writeFile(join(base,page),'<!DOCTYPE html>\n'+htmlSafeSvg(d.documentElement.outerHTML));
 }
}
