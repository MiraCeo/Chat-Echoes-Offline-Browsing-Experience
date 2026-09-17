// Shared by static generation and the browser; only frozen official markup is used.
export function applyProjectLabel(row,title,project,template){
 const marquee=row.querySelector('._NCija_viewport'),host=marquee?.closest('div.truncate');if(!host)return;
 const old=row.querySelector('[data-sidebar-project-name]');if(old){host.replaceChildren(marquee);marquee.removeAttribute('data-marquee-overflowing')}
 if(project){const block=template.cloneNode(true);block.querySelector('._NCija_content').textContent=title;const label=block.lastElementChild;label.textContent=project.name;label.dataset.sidebarProjectName='';label.title=project.name;host.replaceChildren(block)}
 const a=row.querySelector('a');a.setAttribute('aria-label',title+(project?' — 项目 '+project.name+' 中的聊天':'')+(row.querySelector('[data-chat-pinned=true]')?'，已置顶对话':''));
}
