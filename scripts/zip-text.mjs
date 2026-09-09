import {deflateRawSync} from 'node:zlib';
const table=Uint32Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0});
function crc32(bytes){let crc=0xffffffff;for(const b of bytes)crc=table[(crc^b)&255]^(crc>>>8);return (crc^0xffffffff)>>>0}
// Standard ZIP with UTF-8 names and raw DEFLATE. No paths, resources or ZIP64.
export function zipTextFiles(files){
 if(files.length>65535)throw Error('ZIP 文件数量超出限制');const local=[],central=[];let offset=0,total=0;
 for(const {name,text} of files){if(!name||/[\\/\x00]/.test(name)||name==='.'||name==='..')throw Error('无效 ZIP 文件名');const filename=Buffer.from(name,'utf8'),data=Buffer.from(text,'utf8');total+=data.length;if(total>200*1024*1024)throw Error('项目文本超过 200 MiB，请分批转存');const compressed=deflateRawSync(data),crc=crc32(data);if(filename.length>65535)throw Error('ZIP 文件名过长');
  const head=Buffer.alloc(30);head.writeUInt32LE(0x04034b50);head.writeUInt16LE(20,4);head.writeUInt16LE(0x800,6);head.writeUInt16LE(8,8);head.writeUInt16LE(33,12);head.writeUInt32LE(crc,14);head.writeUInt32LE(compressed.length,18);head.writeUInt32LE(data.length,22);head.writeUInt16LE(filename.length,26);local.push(head,filename,compressed);
  const entry=Buffer.alloc(46);entry.writeUInt32LE(0x02014b50);entry.writeUInt16LE(20,4);entry.writeUInt16LE(20,6);entry.writeUInt16LE(0x800,8);entry.writeUInt16LE(8,10);entry.writeUInt16LE(33,14);entry.writeUInt32LE(crc,16);entry.writeUInt32LE(compressed.length,20);entry.writeUInt32LE(data.length,24);entry.writeUInt16LE(filename.length,28);entry.writeUInt32LE(offset,42);central.push(entry,filename);offset+=head.length+filename.length+compressed.length;
 }
 const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...local,directory,end]);
}
export function uniqueMarkdownNames(titles,filename){const used=new Set();return titles.map(title=>{const base=filename(title).slice(0,-3);let name=base+'.md',n=2;while(used.has(name.normalize('NFKC').toLowerCase()))name=base+' ('+(n++)+').md';used.add(name.normalize('NFKC').toLowerCase());return name})}
