// One-time capture only. Ordinary builds never read the reference directory.
import {readFile,writeFile,copyFile} from 'node:fs/promises';
import {basename,dirname,join} from 'node:path';
import {parseHTML} from 'linkedom';
const [input,positionInput]=process.argv.slice(2);
if(!input||!positionInput)throw new Error('Pass reference HTML and measured positioning JSON explicitly');
const d=parseHTML(await readFile(input,'utf8')).document;
const measured=JSON.parse((await readFile(positionInput,'utf8')).replace(/^\uFEFF/,''));
if(measured.menus?.length!==2)throw new Error('Expected measured main menu and submenu');
const layouts=measured.menus.map((record,index)=>{
 const wrapper=parseHTML(record.menuHTML).document.querySelector('[data-radix-popper-content-wrapper]');
 const menu=wrapper?.querySelector('[role=menu]');
 if(!menu||!record.anchorRect||!record.wrapperRect)throw new Error('Missing official wrapper or anchor measurement');
 for(const e of [wrapper,...wrapper.querySelectorAll('*')])for(const a of [...e.attributes])if(a.name.startsWith('on'))e.removeAttribute(a.name);
 const a=record.anchorRect,w=record.wrapperRect;
 return {wrapper:wrapper.outerHTML,menuRect:record.menuRect,wrapperRect:w,anchorRect:a,anchorHTML:record.anchorHTML,
  side:menu.getAttribute('data-side'),align:menu.getAttribute('data-align'),
  // These are measured offsets supplied by the user, not guessed design values.
  offset:{x:w.left-(index===0?a.left:a.right),y:w.top-(index===0?a.bottom:a.top)}};
});
const stylesheets=[],assetNames=new Map();
for(const l of d.querySelectorAll('link[rel=stylesheet]')){
 const name=basename(new URL(l.getAttribute('href'),'https://chatgpt.com').pathname);
 const src=join(dirname(input),'焦点html_files',name),data=await readFile(src);
 let output=name;try{if(!(await readFile(join('official-templates/assets',name))).equals(data))output='chat-menu-'+name}catch{}
 await copyFile(src,join('official-templates/assets',output));if(!stylesheets.includes(output))stylesheets.push(output);assetNames.set(l.getAttribute('href'),output);
}
await writeFile('official-templates/chat-menu.json',JSON.stringify({version:2,source_mode:'frozen_package',viewport:measured.viewport,
 htmlAttributes:Object.fromEntries([...d.documentElement.attributes].map(a=>[a.name,a.value])),
 styleSequence:[...d.querySelectorAll('link[rel=stylesheet],style[data-tailwind-layer-order]')].map(e=>e.tagName==='STYLE'?{text:e.textContent}:{file:assetNames.get(e.getAttribute('href'))}),layouts,stylesheets},null,2));
console.log('Frozen complete official wrappers, menu trees, CSS and two measured anchor relationships.');
