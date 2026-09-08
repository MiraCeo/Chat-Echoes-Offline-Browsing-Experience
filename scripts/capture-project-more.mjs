// Explicit capture only; runtime never reads references.
import{readFile,writeFile}from'node:fs/promises';import{parseHTML}from'linkedom';
const input=JSON.parse((await readFile('参考文件/项目菜单定位.json','utf8')).replace(/^\uFEFF/,''));
const record=input.menus.find(m=>m.menuHTML.includes('重命名项目'));
if(!record?.anchorRect||!record.wrapperRect||record.side!=='bottom'||record.align!=='start')throw new Error('Missing measured project menu/anchor');
const wrapper=parseHTML(record.wrapperHTML).document.querySelector('[data-radix-popper-content-wrapper]');
if(!wrapper?.querySelector('[role=menu]'))throw new Error('Missing official wrapper');
const layout={viewport:input.viewport,side:record.side,align:record.align,anchorRect:record.anchorRect,wrapperRect:record.wrapperRect,menuRect:record.menuRect,offset:{x:record.wrapperRect.left-record.anchorRect.left,y:record.wrapperRect.top-record.anchorRect.bottom}};
await writeFile('official-templates/project-more.json',JSON.stringify({menu:wrapper.outerHTML,layout},null,2)+'\n');
console.log('Frozen measured project menu:',layout.offset);
