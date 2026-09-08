(() => {
const id=new URLSearchParams(location.search).get('id'),list=document.querySelector('[data-project-conversations]'),status=document.querySelector('[data-project-detail-status]'),title=document.querySelector('[name=project-title]'),input=document.querySelector('[data-ceobe-import-input]');
const initial=JSON.parse(document.getElementById('ceobe-projects-data').textContent),previews=JSON.parse(document.getElementById('ceobe-project-previews').textContent);
let projects=initial,chats=[],generation=0,editing=false;
const date=c=>{const v=c.updated_at||c.created_at||c.captured_at;const d=new Date(typeof v==='number'?v*1000:v);return Number.isNaN(d.getTime())?'':d.toLocaleDateString('zh-CN',{month:'long',day:'numeric'})};
function render(){if(editing)return;const project=projects.find(p=>p.id===id);list.replaceChildren();document.body.dataset.projectImportId=project?.id||'';document.body.dataset.projectImportName=project?.name||'';
 title.textContent=project?.name||'项目不存在';document.title=(project?.name||'项目不存在')+' · CEOBE';input.setAttribute('aria-label',project?'导入会话到“'+project.name+'”':'项目不存在，无法导入');
 if(!project){status.textContent='未找到此本地项目，请返回项目列表。';return}
 const box=document.querySelector('main [data-testid=project-folder-icon]'),bank=document.querySelector(`[data-project-picker] input[name=projectIcon][value="${project.icon}"]`);if(bank){const use=bank.closest('label').querySelector('use');box.querySelector('use').setAttribute('href',use.getAttribute('href'))}box.style.color=project.color==='default'?'var(--icon-primary)':project.color;
 box.closest('button').setAttribute('aria-label','项目图标：'+project.icon);box.querySelector('svg').setAttribute('aria-label','项目图标');
 const members=chats.filter(c=>project.conversation_ids?.includes(c.id)).sort((a,b)=>String(b.updated_at||b.captured_at).localeCompare(String(a.updated_at||a.captured_at)));
 for(const c of members){const row=document.getElementById('ceobe-project-conversation-row').firstElementChild.cloneNode(true),a=row.querySelector('a'),b=row.querySelector('button');row.dataset.projectChatId=c.id;a.href='./conversations/'+encodeURIComponent(c.id)+'.html';a.setAttribute('aria-description','最后更新时间：'+date(c));a.querySelector('.font-medium').textContent=c.title;a.querySelector('.text-token-text-secondary').textContent=previews[c.id]||'';row.querySelector('[data-testid=project-conversation-overflow-date]').textContent=date(c);b.dataset.ceobeChatId=c.id;b.dataset.chatPinned=String(Boolean(c.pinned_at));b.dataset.conversationOptionsTrigger=c.id;b.id='project-chat-options-'+c.id;b.setAttribute('aria-label','打开“'+c.title+'”的对话选项');b.setAttribute('aria-controls','ceobe-chat-menu');list.append(row)}
 status.textContent=members.length?'':'此项目还没有会话，可在上方导入，或通过聊天菜单移入。';
}
async function load(){const token=++generation;try{const [pr,cr]=await Promise.all([fetch('/api/projects',{cache:'no-store'}),fetch('/api/chats',{cache:'no-store'})]);const [p,c]=await Promise.all([pr.json(),cr.json()]);if(!pr.ok||!cr.ok||!Array.isArray(p.projects)||!Array.isArray(c.conversations))throw new Error();if(token!==generation)return;projects=p.projects;chats=c.conversations;render()}catch{if(token===generation){render();status.textContent+=' 当前为本地只读快照，无法确认最新项目关联。'}}}
chats=JSON.parse(document.getElementById('ceobe-chat-catalog').textContent).slice();render();load();
list.addEventListener('click',e=>{if(e.target.closest('button,a,input'))return;e.target.closest('li')?.querySelector('a')?.click()});
list.addEventListener('focusin',e=>{if(e.target.matches('input[name=title-editor]'))editing=true});
document.addEventListener('ceobe:chat-updated',()=>{editing=false;load()});document.addEventListener('ceobe:project-moved',load);document.addEventListener('ceobe:project-created',load);document.addEventListener('ceobe:project-imported',load);window.addEventListener('focus',()=>{if(!editing)load()});
document.addEventListener('click',e=>{if(e.target.closest('main [aria-disabled=true]')){e.preventDefault();e.stopPropagation()}},true);
})();
