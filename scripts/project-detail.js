(() => {
const pageAbort=window.__ceobeTopPageAbort&&!window.__ceobeTopPageAbort.signal.aborted?window.__ceobeTopPageAbort:(window.__ceobeTopPageAbort=new AbortController()),pageSignal=pageAbort.signal;
const id=new URLSearchParams(location.search).get('id'),list=document.querySelector('[data-project-conversations]'),status=document.querySelector('[data-project-detail-status]'),title=document.querySelector('[name=project-title]'),input=document.querySelector('[data-ceobe-import-input]');
const memoryGroups={User:'g1','国庆':'gq'};
let memoryIndex=null;
fetch('./public/memory-project-index.json',{cache:'no-store'}).then(r=>r.ok?r.json():null).then(data=>{memoryIndex=data;render()}).catch(()=>{});
const initial=JSON.parse(document.getElementById('ceobe-projects-data').textContent),previews=JSON.parse(document.getElementById('ceobe-project-previews').textContent);
let projects=initial,chats=[],generation=0,editing=false;
const date=c=>{const v=c.updated_at||c.created_at||c.captured_at;const d=new Date(typeof v==='number'?v*1000:v);return Number.isNaN(d.getTime())?'':d.toLocaleDateString('zh-CN',{month:'long',day:'numeric'})};
function renderMemorySummary(project){
 const old=document.querySelector('[data-project-memory-summary]');old?.remove();
 const group=memoryGroups[project?.name],info=group&&memoryIndex?.groups?.[group];
 if(!info||!list)return;
 const section=document.createElement('section');section.className='ceobe-project-memory-summary';section.dataset.projectMemorySummary='';
 const head=document.createElement('div');head.className='ceobe-project-memory-head';
 const h=document.createElement('h2');h.textContent='组记忆 · '+info.name;head.append(h);
 const meta=document.createElement('p');meta.textContent=`${info.coverage?.sessions??'—'} 个会话 · ${info.coverage?.rounds??'—'} 轮 · 截至 ${info.as_of}`;head.append(meta);
 const link=document.createElement('a');link.href='./memory.html?group='+encodeURIComponent(group);link.textContent='打开组记忆';link.className='ceobe-project-memory-link';head.append(link);
 section.append(head);
 if(info.mainlines?.length){const row=document.createElement('div');row.className='ceobe-project-memory-mainlines';for(const item of info.mainlines){const chip=document.createElement('span');chip.textContent=item.label||item.id;row.append(chip)}section.append(row)}
 list.before(section);
}
function render(){if(editing)return;const project=projects.find(p=>p.id===id);list.replaceChildren();document.body.dataset.projectImportId=project?.id||'';document.body.dataset.projectImportName=project?.name||'';
 const more=document.querySelector('[data-project-more-current]');if(more)more.dataset.projectPinned=String(!!project?.pinned_at);
 title.textContent=project?.name||'项目不存在';document.title=(project?.name||'项目不存在')+' · CEOBE';input.setAttribute('aria-label',project?'导入会话到“'+project.name+'”':'项目不存在，无法导入');
 if(!project){status.textContent='未找到此本地项目，请返回项目列表。';return}let memoryLink=document.querySelector('[data-project-memory]');if(!memoryLink){const exportButton=document.querySelector('[data-project-export]');if(exportButton){memoryLink=document.createElement('a');memoryLink.dataset.projectMemory='';memoryLink.className=exportButton.className;memoryLink.innerHTML='<div class="flex w-full items-center justify-center gap-1.5"><span>组记忆</span></div>';memoryLink.setAttribute('aria-label','打开项目所在组的记忆');exportButton.after(memoryLink)}}if(memoryLink){const group=memoryGroups[project.name];if(group){memoryLink.href='./memory.html?group='+encodeURIComponent(group);memoryLink.hidden=false;memoryLink.setAttribute('aria-label','打开'+project.name+'所在组的记忆')}else{memoryLink.hidden=true}}
 renderMemorySummary(project);
 const box=document.querySelector('main [data-testid=project-folder-icon]'),bank=document.querySelector(`[data-project-picker] input[name=projectIcon][value="${project.icon}"]`);if(bank){const use=bank.closest('label').querySelector('use');box.querySelector('use')?.setAttribute('href',use.getAttribute('href'))}box.style.color=project.color==='default'?'var(--icon-primary)':project.color;
 // 页头图标现在是非交互容器（role=img），不再是 button：用触发器标记定位，并对图标缺失做保护。
 const shell=box.closest('[data-testid=project-modal-trigger]'),iconName=document.getElementById('ceobe-project-icons')?.textContent;
 let iconLabel=project.icon;try{iconLabel=JSON.parse(iconName||'{}')[project.icon]?.label||project.icon}catch{}
 if(shell)shell.setAttribute('aria-label','项目图标：'+iconLabel);box.querySelector('svg')?.setAttribute('aria-label','项目图标');
 const members=chats.filter(c=>project.conversation_ids?.includes(c.id)).sort((a,b)=>String(b.updated_at||b.captured_at).localeCompare(String(a.updated_at||a.captured_at)));
 for(const c of members){const row=document.getElementById('ceobe-project-conversation-row').firstElementChild.cloneNode(true),a=row.querySelector('a'),b=row.querySelector('button');row.dataset.projectChatId=c.id;a.href='./conversations/'+encodeURIComponent(c.id)+'.html';a.setAttribute('aria-description','最后更新时间：'+date(c));a.querySelector('.font-medium').textContent=c.title;a.querySelector('.text-token-text-secondary').textContent=previews[c.id]||'';row.querySelector('[data-testid=project-conversation-overflow-date]').textContent=date(c);b.dataset.ceobeChatId=c.id;b.dataset.chatPinned=String(Boolean(c.pinned_at));b.dataset.conversationOptionsTrigger=c.id;b.id='project-chat-options-'+c.id;b.setAttribute('aria-label','打开“'+c.title+'”的对话选项');b.setAttribute('aria-controls','ceobe-chat-menu');list.append(row)}
 status.textContent=members.length?'':'此项目还没有会话，可在上方导入，或通过聊天菜单移入。';
}
async function load(){const token=++generation;try{const [pr,cr]=await Promise.all([fetch('/api/projects',{cache:'no-store'}),fetch('/api/chats',{cache:'no-store'})]);const [p,c]=await Promise.all([pr.json(),cr.json()]);if(!pr.ok||!cr.ok||!Array.isArray(p.projects)||!Array.isArray(c.conversations))throw new Error();if(token!==generation)return;projects=p.projects;chats=c.conversations;render()}catch{if(token===generation){render();status.textContent+=' 当前为本地只读快照，无法确认最新项目关联。'}}}
// 会话清单改由 chats.json 提供（页面里不再内嵌全部会话）；本地服务可用时 load() 会换成最新数据。
chats=[];render();load();fetch(new URL('chats.json',location.href),{cache:'no-store'}).then(r=>r.ok?r.json():null).then(d=>{if(chats.length||!Array.isArray(d?.chats))return;chats=d.chats;render()}).catch(()=>{});
list.addEventListener('click',e=>{if(e.target.closest('button,a,input'))return;e.target.closest('li')?.querySelector('a')?.click()});
list.addEventListener('focusin',e=>{if(e.target.matches('input[name=title-editor]'))editing=true});
document.addEventListener('ceobe:chat-updated',()=>{editing=false;load()},{signal:pageSignal});document.addEventListener('ceobe:project-updated',load,{signal:pageSignal});document.addEventListener('ceobe:project-moved',load,{signal:pageSignal});document.addEventListener('ceobe:project-created',load,{signal:pageSignal});document.addEventListener('ceobe:project-imported',load,{signal:pageSignal});window.addEventListener('focus',()=>{if(!editing)load()},{signal:pageSignal});
document.addEventListener('click',e=>{if(e.target.closest('main [aria-disabled=true]')){e.preventDefault();e.stopPropagation()}},{capture:true,signal:pageSignal});
})();
