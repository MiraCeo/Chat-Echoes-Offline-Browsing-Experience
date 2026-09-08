(() => {
 const sidebar=document.getElementById('stage-slideover-sidebar'),rail=document.getElementById('stage-sidebar-tiny-bar'),panel=document.querySelector('[data-ceobe-sidebar-panel]'),dialog=document.querySelector('[data-ceobe-search]');if(!sidebar||!rail||!panel||!dialog)return;
 const root=new URL(location.pathname.includes('/conversations/')?'../':'./',location.href),key='ceobe.sidebar-collapsed.v1';
 const input=dialog.querySelector('input'),list=dialog.querySelector('ol'),heading=dialog.querySelector('h3'),clear=dialog.querySelector('.F_cuGW_clearButton'),divider=dialog.querySelector('.F_cuGW_headerActionDivider'),status=dialog.querySelector('[data-ceobe-search-status]');
 const initial=JSON.parse(document.getElementById('ceobe-chat-catalog').textContent);let catalog=initial,opener=null,inerted=[],generation=0,offline=false;
 const normal=s=>String(s||'').normalize('NFKC').toLocaleLowerCase().trim();
 const visible=e=>e&&e.isConnected&&e.checkVisibility();
 function closeMenus(){for(const event of ['ceobe:close-chat-menu','ceobe:close-project-more','ceobe:close-organizer'])document.dispatchEvent(new Event(event))}
 function setCollapsed(collapsed,focus=false,persist=true){
  closeMenus();const active=document.activeElement;document.documentElement.dataset.ceobeSidebarCollapsed=String(collapsed);sidebar.dataset.state=collapsed?'closed':'open';panel.inert=collapsed;rail.inert=!collapsed;
  for(const b of document.querySelectorAll('[data-ceobe-sidebar-toggle]'))b.setAttribute('aria-expanded',String(!collapsed));
  if(persist)try{localStorage.setItem(key,String(collapsed))}catch{}
  if(focus||(collapsed?panel:rail).contains(active))sidebar.querySelector(`[data-ceobe-sidebar-toggle=${collapsed?'open':'close'}]`).focus({preventScroll:true});
 }
 setCollapsed(document.documentElement.dataset.ceobeSidebarCollapsed==='true',false,false);
 for(const b of document.querySelectorAll('[data-ceobe-sidebar-toggle]'))b.addEventListener('click',()=>setCollapsed(b.dataset.ceobeSidebarToggle==='close',true));
 window.addEventListener('storage',e=>{if(e.key===key)setCollapsed(e.newValue==='true',false,false)});
 function render(){
  const query=normal(input.value),seen=new Set(),matches=catalog.filter(c=>c&&typeof c.id==='string'&&typeof c.title==='string'&&!seen.has(c.id)&&seen.add(c.id)&&(!query||normal(c.title).includes(query)));
  list.replaceChildren();dialog.querySelector('[data-ceobe-search-empty]')?.remove();heading.textContent=(query?'搜索结果':'最近聊天')+(offline?'（离线索引）':'');clear.hidden=divider.hidden=!input.value;
  for(const c of matches){const row=document.getElementById('ceobe-search-row').content.firstElementChild.cloneNode(true),a=row.querySelector('a');a.href=new URL('conversations/'+encodeURIComponent(c.id)+'.html',root).href;a.dataset.searchChatId=c.id;row.querySelector('.F_cuGW_resultTitleText').textContent=c.title;list.append(row)}
  if(!matches.length){const empty=document.getElementById('ceobe-search-empty').content.firstElementChild.cloneNode(true);empty.dataset.ceobeSearchEmpty='';list.after(empty)}
  status.textContent=(offline?'无法刷新索引，使用本页离线索引。':'')+'找到 '+matches.length+' 个聊天。';
 }
 async function refresh(){const token=++generation;try{const r=await fetch(new URL('api/chats',root),{cache:'no-store'}),data=await r.json();if(!r.ok||!Array.isArray(data.conversations))throw Error();if(token!==generation||dialog.hidden)return;catalog=data.conversations;offline=false}catch{if(token!==generation||dialog.hidden)return;offline=true}render()}
 function blockingDialog(){return [...document.querySelectorAll('[role=dialog]')].some(e=>e!==dialog&&visible(e))}
 function openSearch(from){if(blockingDialog())return;if(!dialog.hidden){input.focus();return}closeMenus();opener=from||document.activeElement;dialog.hidden=false;input.value='';render();
  inerted=[...document.body.children].filter(e=>e!==dialog&&!['SCRIPT','STYLE','LINK','TEMPLATE'].includes(e.tagName)).map(e=>[e,e.inert]);for(const [e]of inerted)e.inert=true;
  input.focus();refresh();
 }
 function closeSearch(){if(dialog.hidden)return;generation++;dialog.hidden=true;for(const [e,was]of inerted)e.inert=was;inerted=[];if(visible(opener)&&!opener.closest('[inert]'))opener.focus({preventScroll:true});else sidebar.querySelector(document.documentElement.dataset.ceobeSidebarCollapsed==='true'?'#stage-sidebar-tiny-bar [data-ceobe-search-trigger]':'[data-ceobe-sidebar-panel] [data-ceobe-search-trigger]')?.focus();opener=null}
 for(const b of document.querySelectorAll('[data-ceobe-search-trigger]'))b.addEventListener('click',()=>openSearch(b));
 dialog.querySelector('.F_cuGW_closeButton').addEventListener('click',closeSearch);
 dialog.addEventListener('pointerdown',e=>{if(e.target===dialog)closeSearch()});
 input.addEventListener('input',render);clear.addEventListener('click',()=>{input.value='';render();input.focus()});
 document.addEventListener('ceobe:chat-updated',()=>{if(!dialog.hidden)refresh()});
 dialog.addEventListener('keydown',e=>{
  if(e.isComposing)return;
  if(e.key==='Escape'){e.preventDefault();e.stopPropagation();closeSearch();return}
  const rows=[...list.querySelectorAll('a')],i=rows.indexOf(document.activeElement);
  if(['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();const next=i<0?(e.key==='ArrowDown'?0:rows.length-1):i+(e.key==='ArrowDown'?1:-1);if(next<0)input.focus();else rows[Math.min(next,rows.length-1)]?.focus()}
  else if(e.key==='Enter'&&document.activeElement===input){e.preventDefault();rows[0]?.click()}
  else if(e.key==='Tab'){const stops=[...dialog.querySelectorAll('input,button,a[href]')].filter(e=>visible(e)&&!e.disabled),i=stops.indexOf(document.activeElement);if(e.shiftKey&&i<=0){e.preventDefault();stops.at(-1)?.focus()}else if(!e.shiftKey&&i===stops.length-1){e.preventDefault();stops[0]?.focus()}}
 });
 document.addEventListener('keydown',e=>{
  if(e.isComposing||e.repeat||e.altKey||!(e.ctrlKey||e.metaKey)||blockingDialog())return;
  const k=e.key.toLowerCase();if(k==='k'&&!e.shiftKey){e.preventDefault();openSearch(document.activeElement)}
  else if(k==='s'&&e.shiftKey){e.preventDefault();if(!dialog.hidden)closeSearch();setCollapsed(document.documentElement.dataset.ceobeSidebarCollapsed!=='true')}
  else if(k==='o'&&e.shiftKey){e.preventDefault();closeSearch();if(location.pathname.endsWith('/import.html'))document.querySelector('[data-ceobe-import-input]')?.focus();else location.href=new URL('import.html',root).href}
 });
})();
