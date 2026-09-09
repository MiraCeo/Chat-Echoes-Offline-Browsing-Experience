import {readdir,readFile,mkdir,copyFile,writeFile} from 'node:fs/promises';import {join} from 'node:path';
// Frozen official CSS names fonts with CDN hashes. Resolve those aliases from
// the installed KaTeX distribution, without changing frozen CSS or using a CDN.
export async function localizeGeneratedFonts(output){
 const dir=join(output,'assets');for(const name of await readdir(dir)){if(!name.endsWith('.css'))continue;const file=join(dir,name),css=await readFile(file,'utf8'),local=css.replaceAll('https://cdn.openai.com/common/fonts/openai-sans/v4/OpenAISans-Semibold.woff2','./OpenAISans-Semibold.woff2');if(local!==css)await writeFile(file,local)}
}
export async function restoreKatexFonts(root,output){
 const dir=join(root,'official-templates/assets'),names=new Set();
 for(const name of await readdir(dir)){if(!name.endsWith('.css'))continue;const css=await readFile(join(dir,name),'utf8');for(const match of css.matchAll(/\/cdn\/assets\/(KaTeX_[A-Za-z0-9]+-[A-Za-z]+-[a-z0-9]+\.woff2)/g))names.add(match[1])}
 const target=join(output,'cdn/assets');await mkdir(target,{recursive:true});
 for(const name of names){const canonical=name.replace(/-[a-z0-9]+\.woff2$/,'.woff2'),source=join(root,'node_modules/katex/dist/fonts',canonical);const bytes=await readFile(source);if(bytes.subarray(0,4).toString()!=='wOF2')throw Error('Invalid local KaTeX font: '+canonical);await copyFile(source,join(target,name))}
 return names.size;
}
