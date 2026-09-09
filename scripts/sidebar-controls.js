(() => {
 document.addEventListener('click',e=>{const button=e.target.closest('[data-ceobe-project-new]');if(!button)return;e.preventDefault();e.stopPropagation();document.dispatchEvent(new CustomEvent('ceobe:open-project',{detail:{opener:button}}))},true);
 const sidebar=document.getElementById('stage-slideover-sidebar'),rail=document.getElementById('stage-sidebar-tiny-bar'),panel=document.querySelector('[data-ceobe-sidebar-panel]'),dialog=document.querySelector('[data-ceobe-search]');if(!sidebar||!rail||!panel||!dialog)return;
 const root=new URL(location.pathname.includes('/conversations/')?'../':'./',location.href),key='ceobe.sidebar-collapsed.v1';
 const input=dialog.querySelector('input'),list=dialog.querySelector('ol'),heading=dialog.querySelector('h3'),clear=dialog.querySelector('.F_cuGW_clearButton'),divider=dialog.querySelector('.F_cuGW_headerActionDivider'),status=dialog.querySelector('[data-ceobe-search-status]');
 const initial=JSON.parse(document.getElementById('ceobe-chat-catalog').textContent);let catalog=initial,opener=null,inerted=[],generation=0,offline=false;
 const recentPopup=document.querySelector('[data-ceobe-rail-recent]'),recentTrigger=document.querySelector('[data-ceobe-recent-trigger]'),recentMenu=recentPopup.querySelector('[role=menu]'),recentList=recentMenu.querySelector('ul'),recentLayout=JSON.parse(recentPopup.dataset.layout);let recentGeneration=0,recentEditing=false,recentCloseRequested=false;
 const normal=s=>String(s||'').normalize('NFKC').toLocaleLowerCase().trim();
 const visible=e=>e&&e.isConnected&&e.checkVisibility();
 function closeMenus(){for(const event of ['ceobe:close-chat-menu','ceobe:close-project-more','ceobe:close-organizer','ceobe:close-rail-recent'])document.dispatchEvent(new Event(event))}
 function setCollapsed(collapsed,focus=false,persist=true){
  if(recentEditing)return;
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
 function openSearch(from){if(blockingDialog()||recentEditing)return;if(!dialog.hidden){input.focus();return}closeMenus();opener=from||document.activeElement;dialog.hidden=false;input.value='';render();
  inerted=[...document.body.children].filter(e=>e!==dialog&&!['SCRIPT','STYLE','LINK','TEMPLATE'].includes(e.tagName)).map(e=>[e,e.inert]);for(const [e]of inerted)e.inert=true;
  input.focus();refresh();
 }
 function closeSearch(){if(dialog.hidden)return;generation++;dialog.hidden=true;for(const [e,was]of inerted)e.inert=was;inerted=[];if(visible(opener)&&!opener.closest('[inert]'))opener.focus({preventScroll:true});else sidebar.querySelector(document.documentElement.dataset.ceobeSidebarCollapsed==='true'?'#stage-sidebar-tiny-bar [data-ceobe-search-trigger]':'[data-ceobe-sidebar-panel] [data-ceobe-search-trigger]')?.focus();opener=null}
 for(const b of document.querySelectorAll('[data-ceobe-search-trigger]'))b.addEventListener('click',()=>openSearch(b));
 dialog.querySelector('.F_cuGW_closeButton').addEventListener('click',closeSearch);
 dialog.addEventListener('pointerdown',e=>{if(e.target===dialog)closeSearch()});
 input.addEventListener('input',render);clear.addEventListener('click',()=>{input.value='';render();input.focus()});
 document.addEventListener('ceobe:chat-updated',()=>{recentEditing=false;if(recentCloseRequested){recentCloseRequested=false;closeRecent(false)}else if(!recentPopup.hidden)refreshRecent();if(!dialog.hidden)refresh()});
 function recentRows(){return [...recentList.querySelectorAll('a')]}
 function closeRecent(focus=false){
  if(recentEditing){recentCloseRequested=true;return}
  if(recentPopup.hidden)return;recentGeneration++;recentPopup.hidden=true;recentMenu.dataset.state='closed';recentTrigger.setAttribute('aria-expanded','false');recentTrigger.dataset.state='closed';document.dispatchEvent(new Event('ceobe:close-chat-menu'));if(focus&&visible(recentTrigger))recentTrigger.focus({preventScroll:true});
 }
 function placeRecent(){
  const r=recentTrigger.getBoundingClientRect(),s=recentPopup.style,x=r.right+recentLayout.offset.x,y=r.top+recentLayout.offset.y;
  s.setProperty('--radix-popper-anchor-width',r.width+'px');s.setProperty('--radix-popper-anchor-height',r.height+'px');s.setProperty('--radix-popper-available-width',innerWidth+'px');s.setProperty('--radix-popper-available-height',innerHeight+'px');
  const box=recentPopup.getBoundingClientRect();s.transform=`translate(${Math.max(0,Math.min(x,innerWidth-box.width))}px, ${Math.max(0,Math.min(y,innerHeight-box.height))}px)`;
  for(const e of recentList.querySelectorAll('[data-marquee-text]'))e.toggleAttribute('data-marquee-overflowing',e.querySelector('._NCija_content').getBoundingClientRect().width>e.clientWidth+1);
 }
 function renderRecent(){
  if(recentEditing)return;const active=document.activeElement,focused=recentPopup.contains(active),activeId=active.closest('li')?.querySelector('[data-ceobe-chat-id]')?.dataset.ceobeChatId,action=active.dataset.railAction;
  const seen=new Set(),date=c=>new Date(c.updated_at||c.captured_at||c.created_at||0).getTime()||0;
  const rows=catalog.filter(c=>c&&typeof c.id==='string'&&typeof c.title==='string'&&!seen.has(c.id)&&seen.add(c.id)).sort((a,b)=>date(b)-date(a)).slice(0,Number(recentPopup.dataset.limit));recentList.replaceChildren();
  recentMenu.querySelector('h2').textContent=rows.length?'最近聊天':'最近聊天（暂无聊天）';
  for(const c of rows){const row=document.getElementById('ceobe-rail-recent-row').content.firstElementChild.cloneNode(true),a=row.querySelector('a'),pin=row.querySelector('[data-rail-action=pin]'),more=row.querySelector('[data-rail-action=more]');
   row.dataset.railChatId=c.id;a.href=new URL('conversations/'+encodeURIComponent(c.id)+'.html',root).href;a.setAttribute('aria-label',c.title);a.draggable=false;for(const n of row.querySelectorAll('._NCija_content'))n.textContent=c.title;
   if(location.pathname.endsWith('/'+c.id+'.html')){a.dataset.active='';a.setAttribute('aria-current','page')}
   pin.dataset.chatUnpin=c.id;pin.setAttribute('aria-label',(c.pinned_at?'取消置顶 ':'置顶 ')+c.title);
   more.dataset.ceobeChatId=c.id;more.dataset.chatPinned=String(Boolean(c.pinned_at));more.dataset.conversationOptionsTrigger=c.id;more.id='rail-chat-options-'+c.id;more.setAttribute('aria-label','打开“'+c.title+'”的对话选项');more.setAttribute('aria-controls','ceobe-chat-menu');more.setAttribute('aria-expanded','false');recentList.append(row);
  }
  if(!recentPopup.hidden){placeRecent();if(focused){const match=[...recentList.querySelectorAll('[data-ceobe-chat-id]')].find(b=>b.dataset.ceobeChatId===activeId)?.closest('li');(match?(action?match.querySelector('[data-rail-action='+action+']'):match.querySelector('a')):recentMenu)?.focus({preventScroll:true})}}
 }
 async function refreshRecent(){const token=++recentGeneration;try{const r=await fetch(new URL('api/chats',root),{cache:'no-store'}),data=await r.json();if(!r.ok||!Array.isArray(data.conversations))throw Error();if(token!==recentGeneration||recentPopup.hidden)return;catalog=data.conversations;renderRecent()}catch{if(token===recentGeneration&&!recentPopup.hidden)recentMenu.querySelector('h2').textContent='最近聊天（离线索引）'}}
 function openRecent(keyboard=false){if(blockingDialog()||!dialog.hidden)return;if(!recentPopup.hidden){closeRecent(true);return}closeMenus();recentCloseRequested=false;recentPopup.hidden=false;recentMenu.dataset.state='open';recentTrigger.dataset.state='open';recentTrigger.setAttribute('aria-expanded','true');renderRecent();(keyboard?recentRows()[0]||recentMenu:recentMenu).focus({preventScroll:true});refreshRecent()}
 const insideRecent=e=>recentPopup.contains(e)||recentTrigger.contains(e)||Boolean(e.closest('[data-ceobe-chat-menu],[data-ceobe-chat-submenu]'));
 recentTrigger.addEventListener('click',e=>openRecent(e.detail===0));
 document.addEventListener('ceobe:close-rail-recent',()=>closeRecent(false));
 document.addEventListener('pointerdown',e=>{if(!recentPopup.hidden&&!insideRecent(e.target))closeRecent(false)});
 document.addEventListener('focusin',e=>{if(!recentPopup.hidden&&!insideRecent(e.target))closeRecent(false)});
 window.addEventListener('resize',()=>closeRecent(false));
 document.addEventListener('scroll',e=>{if(!recentPopup.hidden&&e.target instanceof Element&&!insideRecent(e.target))closeRecent(false)},true);
 document.addEventListener('ceobe:chat-action',e=>{if(e.detail.action==='rename'&&recentPopup.contains(e.detail.opener)&&recentPopup.querySelector('input')){recentEditing=true}});
 recentMenu.addEventListener('keydown',e=>{if(e.defaultPrevented||e.isComposing||e.target.matches('input,textarea'))return;const rows=recentRows(),i=rows.indexOf(document.activeElement);
  if(e.key==='Escape'){e.preventDefault();e.stopPropagation();closeRecent(true)}
  else if(e.key==='Tab')e.preventDefault();
  else if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();rows[e.key==='Home'?0:e.key==='End'?rows.length-1:i<0?(e.key==='ArrowUp'?rows.length-1:0):(i+(e.key==='ArrowDown'?1:-1)+rows.length)%rows.length]?.focus()}
 });
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
