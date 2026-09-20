(() => {
 document.addEventListener('click',e=>{const button=e.target.closest('[data-ceobe-project-new]');if(!button)return;e.preventDefault();e.stopPropagation();document.dispatchEvent(new CustomEvent('ceobe:open-project',{detail:{opener:button}}))},true);
 const sidebar=document.getElementById('stage-slideover-sidebar'),rail=document.getElementById('stage-sidebar-tiny-bar'),panel=document.querySelector('[data-ceobe-sidebar-panel]'),dialog=document.querySelector('[data-ceobe-search]');if(!sidebar||!rail||!panel||!dialog)return;
 const root=new URL(location.pathname.includes('/conversations/')?'../':'./',location.href),key='ceobe.sidebar-collapsed.v1';
 const input=dialog.querySelector('input'),list=dialog.querySelector('ol'),heading=dialog.querySelector('h3'),clear=dialog.querySelector('.F_cuGW_clearButton'),divider=dialog.querySelector('.F_cuGW_headerActionDivider'),status=dialog.querySelector('[data-ceobe-search-status]');
 const initial=JSON.parse(document.getElementById('ceobe-chat-catalog').textContent);let catalog=initial,opener=null,inerted=[],generation=0,offline=false;
 const bodySection=dialog.querySelector('[data-ceobe-search-body]'),bodyList=bodySection.querySelector('ol'),bodyHeading=bodySection.querySelector('h3'),currentChat=document.body.dataset.readerChatId||null;let index=null,indexState='idle',indexPromise=null;let lastQuery=null,forceTop=true;
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
 const BODY_LIMIT=50;
 // Every keystroke replaces the whole result set, so the scroll offset has to travel with it:
 // after a longer previous list the first new hits would otherwise stay scrolled out of view.
 // The official scroller is named; the ancestor walk keeps the reset working if that ever changes.
 const resultScrollers=()=>{const out=new Set([dialog]);for(const start of [list,bodyList])for(let e=start;e&&e!==document.body;e=e.parentElement){if(/(auto|scroll)/.test(getComputedStyle(e).overflowY))out.add(e)}const named=dialog.querySelector('.F_cuGW_resultsScroller');if(named)out.add(named);return [...out]};
 // Body search: one build-time record per rendered turn (replay/public/search-index.json), loaded on first open, matched with the same NFKC folding as titles.
 function loadIndex(){
  if(indexPromise)return indexPromise;indexState='loading';
  return indexPromise=(async()=>{
   try{const r=await fetch(new URL('search-index.json',root),{cache:'no-cache'}),data=await r.json();if(!r.ok||data.kind!=='ceobe.search-index'||!Array.isArray(data.conversations))throw Error();
    index=new Map(data.conversations.filter(c=>c&&typeof c.id==='string').map(c=>[c.id,(Array.isArray(c.turns)?c.turns:[]).filter(t=>t&&typeof t.message_id==='string'&&typeof t.text==='string').map(t=>({...t,key:normal(t.text)}))]));indexState='ready'}
   catch{indexState='failed';indexPromise=null}
   if(!dialog.hidden)render();
  })();
 }
 function mark(el,text,query,cls){
  const pos=query?text.toLocaleLowerCase().indexOf(query):-1;el.replaceChildren();
  if(pos<0||text.slice(pos,pos+query.length).toLocaleLowerCase()!==query){el.textContent=text;return}
  const hit=document.createElement('span');hit.className=cls;hit.textContent=text.slice(pos,pos+query.length);el.append(text.slice(0,pos),hit,text.slice(pos+query.length));
 }
 function snippet(turn,query){
  // Prefer the original casing; fall back to the folded text when the match only exists after NFKC folding (full-width letters, ligatures).
  let source=turn.text,pos=source.toLocaleLowerCase().indexOf(query);
  if(pos<0||source.slice(pos,pos+query.length).toLocaleLowerCase()!==query){source=turn.key;pos=source.indexOf(query)}
  const start=Math.max(0,pos-24),end=Math.min(source.length,pos+query.length+160);
  return {before:(start>0?'…':'')+source.slice(start,pos),match:source.slice(pos,pos+query.length),after:source.slice(pos+query.length,end)+(end<source.length?'…':'')};
 }
 function occurrences(key,query){let n=0,i=key.indexOf(query);while(i>=0){n++;i=key.indexOf(query,i+query.length)}return n}
 function render(){
  // A background catalog/index refresh must not steal keyboard focus from a result the user has already arrowed to.
  const active=document.activeElement,focused=active&&dialog.contains(active)&&active.matches('ol a')?{chat:active.dataset.searchChatId,message:active.dataset.searchMessageId||''}:null;
  const query=normal(input.value),seen=new Set(),chats=catalog.filter(c=>c&&typeof c.id==='string'&&typeof c.title==='string'&&!seen.has(c.id)&&seen.add(c.id)),matches=chats.filter(c=>!query||normal(c.title).includes(query));
  // The effective query is the whole result set, so it also decides when to return to the top.
  let restore=focused;const queryChanged=query!==lastQuery||forceTop;forceTop=false;
  const keepTops=queryChanged?null:resultScrollers().map(s=>s.scrollTop);
  list.replaceChildren();bodyList.replaceChildren();dialog.querySelector('[data-ceobe-search-empty]')?.remove();heading.textContent=(query?'搜索结果':'最近聊天')+(offline?'（离线索引）':'');clear.hidden=divider.hidden=!input.value;
  for(const c of matches){const row=document.getElementById('ceobe-search-row').content.firstElementChild.cloneNode(true),a=row.querySelector('a');a.href=new URL('conversations/'+encodeURIComponent(c.id)+'.html',root).href;a.dataset.searchChatId=c.id;mark(row.querySelector('.F_cuGW_resultTitleText'),c.title,query,'F_cuGW_titleHighlight');list.append(row)}
  // Body hits follow the catalog order, so deleted chats or a stale index never produce dead links.
  const hits=[];let total=0;
  if(query&&index)for(const c of chats)for(const turn of index.get(c.id)||[]){if(!turn.key.includes(query))continue;total++;if(hits.length<BODY_LIMIT)hits.push({c,turn})}
  for(const {c,turn} of hits){
   const row=document.getElementById('ceobe-search-body-row').content.firstElementChild.cloneNode(true),a=row.querySelector('a'),s=snippet(turn,query),sub=row.querySelector('.F_cuGW_resultSubtitle'),hit=document.createElement('span'),n=occurrences(turn.key,query);
   a.href=new URL('conversations/'+encodeURIComponent(c.id)+'.html#bookmark='+encodeURIComponent(turn.message_id),root).href;a.dataset.searchChatId=c.id;a.dataset.searchMessageId=turn.message_id;
   row.querySelector('.F_cuGW_resultTitleText').textContent=c.title;hit.className='F_cuGW_subtitleHighlight';hit.textContent=s.match;sub.replaceChildren(s.before,hit,s.after);
   row.querySelector('.F_cuGW_resultDate').textContent=(turn.role==='user'?'用户':'GPT')+' · 第 '+(Number(turn.order)+1||'?')+' 轮'+(n>1?' · '+n+' 处':'');bodyList.append(row);
  }
  bodySection.hidden=!hits.length;bodyHeading.textContent='正文命中'+(total>hits.length?'（显示前 '+hits.length+' 条，共 '+total+' 条）':'（'+total+' 条）');
  if(!matches.length&&!hits.length){const empty=document.getElementById('ceobe-search-empty').content.firstElementChild.cloneNode(true);empty.dataset.ceobeSearchEmpty='';list.after(empty)}
  status.textContent=(offline?'无法刷新索引，使用本页离线索引。':'')+'找到 '+matches.length+' 个聊天'+(!query?'。':index?'，正文命中 '+total+' 条。':indexState==='loading'?'，正在加载正文索引。':'，正文索引不可用，仅按标题搜索。');

  // A new result set starts at its first row and keeps the caret in the input: restoring the old
  // arrow-key row would drop focus onto a row that is no longer the one the user was reading.
  if(queryChanged){for(const e of resultScrollers())e.scrollTop=0;restore=null}
  // A refresh rebuilds every row, so the browser would otherwise drop the list back to its top; a query
  // that did not change must not move the reader. This runs before the focus is handed back, so keyboard
  // navigation keeps the last word about where the list is scrolled.
  if(keepTops)for(const [i,e] of resultScrollers().entries()){const want=keepTops[i];if(want&&e.scrollTop!==want)e.scrollTop=want}
  lastQuery=query;
  if(restore){const again=[...dialog.querySelectorAll('ol a')].find(a=>a.dataset.searchChatId===restore.chat&&(a.dataset.searchMessageId||'')===restore.message);if(again)again.focus();else input.focus({preventScroll:true})}
 }
 async function refresh(){const token=++generation;try{const r=await fetch(new URL('api/chats',root),{cache:'no-store'}),data=await r.json();if(!r.ok||!Array.isArray(data.conversations))throw Error();if(token!==generation||dialog.hidden)return;catalog=data.conversations;offline=false}catch{if(token!==generation||dialog.hidden)return;offline=true}render()}
 function blockingDialog(){return [...document.querySelectorAll('[role=dialog]')].some(e=>e!==dialog&&visible(e))}
 function openSearch(from){if(blockingDialog()||recentEditing)return;if(!dialog.hidden){input.focus();return}closeMenus();opener=from||document.activeElement;dialog.hidden=false;input.value='';forceTop=true;render();loadIndex();
  inerted=[...document.body.children].filter(e=>e!==dialog&&!['SCRIPT','STYLE','LINK','TEMPLATE'].includes(e.tagName)).map(e=>[e,e.inert]);for(const [e]of inerted)e.inert=true;
  input.focus();refresh();
 }
 function closeSearch(){if(dialog.hidden)return;generation++;dialog.hidden=true;for(const [e,was]of inerted)e.inert=was;inerted=[];if(visible(opener)&&!opener.closest('[inert]'))opener.focus({preventScroll:true});else sidebar.querySelector(document.documentElement.dataset.ceobeSidebarCollapsed==='true'?'#stage-sidebar-tiny-bar [data-ceobe-search-trigger]':'[data-ceobe-sidebar-panel] [data-ceobe-search-trigger]')?.focus();opener=null}
 for(const b of document.querySelectorAll('[data-ceobe-search-trigger]'))b.addEventListener('click',()=>openSearch(b));
 dialog.querySelector('.F_cuGW_closeButton').addEventListener('click',closeSearch);
 dialog.addEventListener('pointerdown',e=>{if(e.target===dialog)closeSearch()});
 input.addEventListener('input',render);clear.addEventListener('click',()=>{input.value='';render();input.focus()});
 document.addEventListener('ceobe:chat-updated',()=>{recentEditing=false;if(recentCloseRequested){recentCloseRequested=false;closeRecent(false)}else if(!recentPopup.hidden)refreshRecent();if(!dialog.hidden)refresh()});
 // Archive changes rebuild the index on disk; drop the cached copy so the next open refetches it (the stale copy stays usable meanwhile).
 for(const event of ['ceobe:chat-updated','ceobe:project-imported'])document.addEventListener(event,()=>{indexPromise=null;if(!dialog.hidden)loadIndex()});
 bodyList.addEventListener('click',e=>{
  const a=e.target.closest('a[data-search-message-id]');if(!a||e.button!==0||e.ctrlKey||e.metaKey||e.shiftKey||e.altKey||a.dataset.searchChatId!==currentChat)return;
  // Same reader page: reuse the exact bookmark jump instead of reloading. If nothing handles the request, the link itself still carries the hash.
  const request=new CustomEvent('ceobe:jump-message',{cancelable:true,detail:{chatId:a.dataset.searchChatId,messageId:a.dataset.searchMessageId}});
  closeSearch();if(!document.dispatchEvent(request))e.preventDefault();
 });
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
 recentMenu.addEventListener('keydown',e=>{
  if(e.defaultPrevented||e.isComposing||e.target.matches('input,textarea'))return;
  const active=document.activeElement,rows=recentRows(),row=active.closest('li'),i=rows.indexOf(row?.querySelector('a'));
  const controls=parent=>[...parent.querySelectorAll('a,button')].filter(b=>visible(b)&&!b.disabled);
  if(e.key==='Escape'){e.preventDefault();e.stopPropagation();closeRecent(true)}
  else if(e.key==='Tab'){
   const stops=controls(recentList),index=stops.indexOf(active),next=index+(e.shiftKey?-1:1);
   if(next>=0&&next<stops.length){e.preventDefault();stops[next].focus({preventScroll:true})}
   // At either boundary, restore the trigger and let native Tab leave the menu.
   else closeRecent(true);
  }
  else if(['ArrowLeft','ArrowRight'].includes(e.key)&&row){
   e.preventDefault();const stops=controls(row),index=stops.indexOf(active);
   stops[Math.max(0,Math.min(stops.length-1,index+(e.key==='ArrowRight'?1:-1)))]?.focus({preventScroll:true});
  }
  else if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){
   e.preventDefault();const next=rows[e.key==='Home'?0:e.key==='End'?rows.length-1:i<0?(e.key==='ArrowUp'?rows.length-1:0):(i+(e.key==='ArrowDown'?1:-1)+rows.length)%rows.length];
   const action=active.dataset.railAction;
   (action?next?.closest('li').querySelector('[data-rail-action='+action+']'):next)?.focus({preventScroll:true});
  }
  else if(e.key===' '&&active.matches('a')){e.preventDefault();active.click()}
 });
 dialog.addEventListener('keydown',e=>{
  if(e.isComposing)return;
  if(e.key==='Escape'){e.preventDefault();e.stopPropagation();closeSearch();return}
  const rows=[...dialog.querySelectorAll('ol a')],i=rows.indexOf(document.activeElement);
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
