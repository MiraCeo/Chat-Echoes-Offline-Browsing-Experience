import {readFile,writeFile,copyFile} from 'node:fs/promises';import{join,dirname,basename}from'node:path';import{parseHTML}from'linkedom';
const [renameInput,deleteInput]=process.argv.slice(2);if(!renameInput||!deleteInput)throw new Error('Pass rename and delete references explicitly');
const r=parseHTML(await readFile(renameInput,'utf8')).document,d=parseHTML(await readFile(deleteInput,'utf8')).document;
const rename=r.querySelector('input[name=title-editor]')?.parentElement.parentElement;
const modal=d.querySelector('[data-testid=modal-delete-conversation-confirmation]');
const header=[...r.querySelectorAll('h2')].find(e=>e.textContent.trim()==='置顶');const pin=header?.closest('.group\\/sidebar-expando-section');
if(!rename||!modal||!pin)throw new Error('Missing official action DOM');
const stylesheets=[];for(const [doc,input]of [[r,renameInput],[d,deleteInput]])for(const link of doc.querySelectorAll('link[rel=stylesheet]')){const href=link.getAttribute('href'),src=join(dirname(input),decodeURIComponent(href));let bytes;try{bytes=await readFile(src)}catch{throw new Error('Missing reference CSS: '+src)}let name=basename(src);try{if(!(await readFile(join('official-templates/assets',name))).equals(bytes))name='chat-actions-'+name}catch{}await copyFile(src,join('official-templates/assets',name));if(!stylesheets.includes(name))stylesheets.push(name)}
for(const el of [rename,modal,pin]){for(const s of el.querySelectorAll('script'))s.remove();for(const n of [el,...el.querySelectorAll('*')])for(const a of [...n.attributes])if(a.name.startsWith('on'))n.removeAttribute(a.name)}
await writeFile('official-templates/chat-actions.json',JSON.stringify({version:1,rename:rename.outerHTML,delete:modal.outerHTML,pinnedSection:pin.outerHTML,stylesheets},null,2));console.log('Frozen inline rename, full delete modal and pinned section/row.');
