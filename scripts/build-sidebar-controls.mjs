import{readFile,writeFile,readdir,copyFile}from'node:fs/promises';import{join}from'node:path';import{createHash}from'node:crypto';import{parseHTML}from'linkedom';import{htmlSafeSvg}from'./serialize-html.mjs';
export async function buildSidebarControls(root){
 const base=join(root,'replay'),f=JSON.parse(await readFile(join(root,'official-templates/sidebar-search.json'),'utf8')),files={};
 for(const name of ['sidebar-controls.js','sidebar-controls.css']){const code=await readFile(join(root,'scripts',name));files[name]=name.replace(/\.(js|css)$/,(ext)=>'.'+createHash('sha256').update(code).digest('hex').slice(0,12)+ext);await writeFile(join(base,files[name]),code)}
 for(const name of f.stylesheets)await copyFile(join(root,'official-templates/assets',name),join(base,'assets',name));
 const pages=(await readdir(base)).filter(n=>n.endsWith('.html')).concat((await readdir(join(base,'conversations'))).filter(n=>n.endsWith('.html')).map(n=>'conversations/'+n));
 for(const page of pages){
  const d=parseHTML(await readFile(join(base,page),'utf8')).document,sidebar=d.getElementById('stage-slideover-sidebar');if(!sidebar)continue;const prefix=page.startsWith('conversations/')?'../':'./',rail=d.getElementById('stage-sidebar-tiny-bar');
  rail.nextElementSibling.dataset.ceobeSidebarPanel='';
  for(const b of sidebar.querySelectorAll('button')){const name=b.getAttribute('aria-label')||b.textContent.trim();if(/^(打开|关闭)侧边栏$/.test(name)){b.dataset.ceobeSidebarToggle=name.startsWith('打开')?'open':'close';b.tabIndex=0;b.setAttribute('aria-keyshortcuts','Control+Shift+S');b.title=name+' (Ctrl+Shift+S)'}else if(['搜索','搜索聊天'].includes(name)){b.dataset.ceobeSearchTrigger='';b.tabIndex=0;b.setAttribute('aria-label','搜索聊天');b.setAttribute('aria-haspopup','dialog');b.setAttribute('aria-keyshortcuts','Control+K');b.title='搜索聊天 (Ctrl+K)'}}
  for(const a of d.querySelectorAll('[data-ceobe-import-share]'))a.setAttribute('aria-keyshortcuts','Control+Shift+O');
  const dialog=parseHTML(f.dialog).document.firstElementChild;dialog.dataset.ceobeSearch='';dialog.hidden=true;dialog.querySelector('h2').textContent='搜索聊天';dialog.querySelector('input').placeholder='搜索聊天标题…';dialog.querySelector('input').setAttribute('aria-label','搜索聊天标题');dialog.querySelector('.F_cuGW_closeButton').setAttribute('aria-label','关闭搜索聊天');
  const status=d.createElement('p');status.className='sr-only';status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.dataset.ceobeSearchStatus='';dialog.append(status);d.body.append(dialog);
  for(const [id,html]of [['ceobe-search-row',f.row],['ceobe-search-empty',f.empty]]){const template=d.createElement('template');template.id=id;template.innerHTML=html;for(const use of template.content.querySelectorAll('use')){const href=use.getAttribute('href');use.setAttribute('href',prefix+'cdn/assets/'+(href.includes('sprites-shell')?'sprites-shell-097001e7.svg':'sprites-core-26c3f2d4.svg')+'#'+href.split('#')[1])}d.body.append(template)}
  for(const use of dialog.querySelectorAll('use')){const href=use.getAttribute('href');use.setAttribute('href',prefix+'cdn/assets/'+(href.includes('sprites-shell')?'sprites-shell-097001e7.svg':'sprites-core-26c3f2d4.svg')+'#'+href.split('#')[1])}
  const boot=d.createElement('script');boot.textContent="try{document.documentElement.dataset.ceobeSidebarCollapsed=localStorage.getItem('ceobe.sidebar-collapsed.v1')==='true'?'true':'false'}catch{}";d.head.prepend(boot);
  for(const name of [...f.stylesheets.map(n=>'assets/'+n),files['sidebar-controls.css']]){const link=d.createElement('link');link.rel='stylesheet';link.href=prefix+name;d.head.append(link)}
  const script=d.createElement('script');script.type='module';script.src=prefix+files['sidebar-controls.js'];d.body.append(script);
  await writeFile(join(base,page),'<!DOCTYPE html>\n'+htmlSafeSvg(d.documentElement.outerHTML));
 }
}
