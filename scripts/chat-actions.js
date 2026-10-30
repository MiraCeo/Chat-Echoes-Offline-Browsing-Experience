import {createChatOrganizer} from './chat-organizer.js';
import {applyProjectLabel} from './sidebar-project-label.js';
(() => {
if (window.__ceobeChatActions) return;
window.__ceobeChatActions = true;
const recent=document.querySelector('[data-chat-recent-list]'),pinned=document.querySelector('[data-chat-pinned-section]'),dialog=document.querySelector('[data-chat-delete]'),status=document.getElementById('ceobe-chat-status');
const prefix=location.pathname.includes('/conversations/')?'../':'./';let catalog=[],catalogLoaded=false,writable=false,editing=null,deleting=null,inerted=[],busy=false;
// 会话列表由构建期写成一行模板（#ceobe-sidebar-chat-row），浏览器按 chats.json 复制出全部行。
// 页面里既不含全部会话的 <li>，也不含 #ceobe-chat-catalog，删改会话才不会改写每一页。
const rowTemplate=document.getElementById('ceobe-sidebar-chat-row'),staticRow=recent?.firstElementChild||null;
// 活动态按页面自己的会话决定：导图/资料库/项目页的 body 里没有 readerChatId，也没有活动行。
const currentChatId=()=>['data-ceobe-import-page','data-ceobe-project-detail','data-ceobe-projects-page','data-ceobe-asset-library'].some(attribute=>document.body.hasAttribute(attribute))?'':document.body.dataset.readerChatId||(location.pathname.match(/\/conversations\/([^/]+)\.html$/)?.[1]||'');
let pageChatId=currentChatId();
let projects=JSON.parse(document.getElementById('ceobe-projects-data').textContent),projectGeneration=0;
const labelTemplate=document.getElementById('ceobe-sidebar-project-label').content.firstElementChild;
const pinKey='ceobe.pinned-expanded.v1';let pinnedExpanded=true;try{pinnedExpanded=localStorage.getItem(pinKey)!=='false'}catch{}
 function paintPinned(){if(!pinned)return;const button=pinned.querySelector('button'),svg=button.querySelector('svg');pinned.querySelector('ul').hidden=!pinnedExpanded;button.setAttribute('aria-expanded',String(pinnedExpanded));document.documentElement.dataset.ceobePinnedCollapsed=String(!pinnedExpanded);svg.querySelector('use').setAttribute('href',prefix+'cdn/assets/sprites-shell-097001e7.svg#'+(pinnedExpanded?'chevron-down-sm':'chevron-right-sm'));svg.setAttribute('class',pinnedExpanded?'invisible h-3 w-3 shrink-0 group-hover/sidebar-expando-section:visible':'h-3 w-3 shrink-0 group-hover/sidebar-expando-section:block');svg.toggleAttribute('data-rtl-flip',!pinnedExpanded)}
 window.addEventListener('storage',e=>{if(e.key===pinKey){pinnedExpanded=e.newValue!=='false';paintPinned()}});
 const overflow=new ResizeObserver(entries=>{for(const {target:e}of entries)e.toggleAttribute('data-marquee-overflowing',e.querySelector('._NCija_content').getBoundingClientRect().width>e.clientWidth+1)});
async function loadProjects(){const token=++projectGeneration;try{const r=await fetch('/api/projects',{cache:'no-store'}),data=await r.json();if(r.ok&&Array.isArray(data.projects)&&token===projectGeneration){projects=data.projects;render()}}catch{}}
for(const event of ['ceobe:project-moved','ceobe:project-created','ceobe:project-updated'])document.addEventListener(event,loadProjects);
document.addEventListener('ceobe:project-imported',load);
 const organizer=createChatOrganizer(recent);
document.addEventListener('ceobe:organizer-change',render);
function tell(text){status.textContent=text;status.hidden=false}
async function post(data){const r=await fetch('/api/chats',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const body=await r.json().catch(()=>null);if(!r.ok||!body)throw new Error(body?.error||'本地服务不可用，操作未确认成功');return body}
function render(){
 // 清单还没到（首屏）时保留构建期写的那一行；到齐之后由模板生成全部行。
 if(!recent||!catalogLoaded||editing||document.body.hasAttribute('data-project-editing'))return;overflow.disconnect();recent.replaceChildren();pinned.querySelector('ul').replaceChildren();
 if(!catalog.length){pinned.hidden=true;paintPinned();organizer.update(projects,catalog);return}
 const ordered=[...catalog].sort((a,b)=>String(b.pinned_at||'').localeCompare(String(a.pinned_at||'')));
 for(const [index,c] of ordered.entries()){const source=c.pinned_at?document.getElementById('ceobe-pinned-row').firstElementChild:(rowTemplate?.content?.firstElementChild||staticRow);if(!source)continue;const li=source.cloneNode(true),a=li.querySelector('a'),b=li.querySelector('[data-conversation-options-trigger]');if(!a||!b)continue;a.href=prefix+'conversations/'+c.id+'.html';a.setAttribute('aria-label',c.title+(c.pinned_at?'，已置顶对话':''));a.draggable=false;a.toggleAttribute('data-active',c.id===pageChatId);if(c.id===pageChatId)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');
  for(const n of li.querySelectorAll('._NCija_content'))n.textContent=c.title;
  b.dataset.ceobeChatId=c.id;b.dataset.chatPinned=String(Boolean(c.pinned_at));b.dataset.conversationOptionsTrigger=c.id;b.id='chat-options-'+c.id;b.setAttribute('data-testid','history-item-'+index+'-options');b.setAttribute('aria-label',`打开“${c.title}”的对话选项`);b.setAttribute('aria-controls','ceobe-chat-menu');b.setAttribute('aria-expanded','false');b.dataset.state='closed';b.tabIndex=0;
  const unpin=[...li.querySelectorAll('button')].find(e=>e!==b);if(unpin){unpin.dataset.chatUnpin=c.id;unpin.setAttribute('aria-label',(c.pinned_at?'取消置顶 ':'置顶 ')+c.title)}
  for(const use of li.querySelectorAll('use')){const h=use.getAttribute('href');if(h.includes('f705d3e2')||h.includes('e289d166'))use.setAttribute('href',prefix+'cdn/assets/'+(h.includes('sprites-shell')?'sprites-shell-097001e7.svg':'sprites-core-26c3f2d4.svg')+'#'+h.split('#')[1])}
  applyProjectLabel(li,c.title,projects.find(p=>p.conversation_ids?.includes(c.id)),labelTemplate);
   (c.pinned_at?pinned.querySelector('ul'):recent).append(li);
   if(li.querySelector('[data-sidebar-project-name]'))overflow.observe(li.querySelector('._NCija_viewport'));
 }
 pinned.hidden=!catalog.some(c=>c.pinned_at);paintPinned();
  organizer.update(projects,catalog);
 const current=catalog.find(c=>c.id===pageChatId);if(current)document.title=current.title;
}
// 构建期写出的静态清单（replay/chats.json）先撑起侧栏；本地服务可用时 load() 会换成最新数据。
function markSidebarReady(){document.documentElement.dataset.ceobeSidebarChats='ready'}
function seedCatalog(){fetch(new URL(prefix+'chats.json',location.href),{cache:'no-store'}).then(r=>r.ok?r.json():null).then(data=>{if(catalogLoaded||!Array.isArray(data?.chats))return;catalog=data.chats;catalogLoaded=true;render();markSidebarReady()}).catch(()=>{})}
async function load(){loadProjects();try{const r=await fetch('/api/chats',{cache:'no-store'}),data=await r.json();if(!r.ok||!Array.isArray(data.conversations))throw new Error();catalog=data.conversations;catalogLoaded=true;writable=true;render();markSidebarReady()}catch{writable=false}}
function update(c){catalog=catalog.map(x=>x.id===c.id?c:x);render();document.dispatchEvent(new Event('ceobe:chat-updated'))}
function rename(c,opener){
 if(editing)return;const old=opener?.closest('li')||document.querySelector(`[data-ceobe-chat-id="${c.id}"]`)?.closest('li');if(!old)return;
 const row=document.getElementById('ceobe-rename-row').content.firstElementChild.cloneNode(true),input=row.querySelector('input');input.value=c.title;input.maxLength=200;old.replaceChildren(row);editing=c.id;
 let pending=false,done=false;
 const cancel=()=>{if(pending)return;done=true;editing=null;render();document.dispatchEvent(new Event('ceobe:chat-updated'))};
 const save=async()=>{if(done||pending)return;const title=input.value.trim();if(title===c.title){cancel();return}if(!title){tell('聊天标题不能为空');input.focus();return}pending=true;input.readOnly=true;try{const result=await post({id:c.id,action:'rename',title});done=true;editing=null;update(result.conversation);tell('聊天已重命名')}catch(e){tell(e.message);input.focus()}finally{pending=false;input.readOnly=false}};
 input.addEventListener('keydown',e=>{if(e.isComposing)return;if(e.key==='Enter'){e.preventDefault();save()}else if(e.key==='Escape'){e.preventDefault();cancel()}});input.addEventListener('blur',save);input.focus();input.select();
}
function closeDelete(){if(busy)return;dialog.hidden=true;for(const [e,was]of inerted)e.inert=was;inerted=[];document.querySelector(`[data-ceobe-chat-id="${deleting?.id}"]`)?.focus();deleting=null}
function openDelete(c){deleting=c;dialog.querySelector('strong').textContent=c.title;dialog.querySelector('[role=status]').textContent='将永久删除本地全部归档版本和阅读页面，并清除项目关联、该聊天的全部书签及个人备注。此操作无法撤销。';dialog.hidden=false;for(const e of document.body.children)if(e!==dialog&&!['SCRIPT','LINK','STYLE','TEMPLATE'].includes(e.tagName)){inerted.push([e,e.inert]);e.inert=true}dialog.querySelector('.btn-secondary').focus()}
const confirm=dialog.querySelector('[data-testid=delete-conversation-confirm-button]'),cancel=dialog.querySelector('.btn-secondary');cancel.addEventListener('click',closeDelete);
confirm.addEventListener('click',async()=>{if(busy||!deleting)return;busy=true;confirm.disabled=cancel.disabled=true;dialog.setAttribute('aria-busy','true');dialog.querySelector('[role=status]').textContent='正在准备安全删除并重建页面，请勿关闭本地服务…';try{await post({id:deleting.id,action:'delete',confirm:deleting.id});location.href=prefix+'index.html'}catch(e){dialog.querySelector('[role=status]').textContent=e.message}finally{busy=false;confirm.disabled=cancel.disabled=false;dialog.removeAttribute('aria-busy')}});
dialog.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();closeDelete()}if(e.key==='Tab'){e.preventDefault();(document.activeElement===cancel?confirm:cancel).focus()}});
document.addEventListener('ceobe:chat-action',async e=>{const c=catalog.find(x=>x.id===e.detail.id);if(!c)return;if(!writable){tell('当前服务不可写，请使用本地开发或预览服务。');return}if(e.detail.action==='rename')rename(c,e.detail.opener);else if(e.detail.action==='delete')openDelete(c);else if(e.detail.action==='pin'){try{const result=await post({id:c.id,action:'pin',pinned:!c.pinned_at});update(result.conversation)}catch(err){tell(err.message)}}});
document.addEventListener('click',e=>{const b=e.target.closest('[data-chat-unpin]');if(b){e.preventDefault();e.stopPropagation();document.dispatchEvent(new CustomEvent('ceobe:chat-action',{detail:{id:b.dataset.chatUnpin,action:'pin'}}))}},true);
pinned?.querySelector('button')?.addEventListener('click',()=>{pinnedExpanded=!pinnedExpanded;try{localStorage.setItem(pinKey,String(pinnedExpanded))}catch{}paintPinned()});
render();seedCatalog();load();window.addEventListener('focus',()=>{if(!editing&&!deleting)load()});
document.addEventListener('turbo:load',()=>{pageChatId=currentChatId();if(catalogLoaded)render();markSidebarReady();load()});
})();
