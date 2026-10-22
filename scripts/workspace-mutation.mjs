import {mkdir,open,unlink,readdir,lstat,readFile,stat} from 'node:fs/promises';
import {join} from 'node:path';

// 进程被杀掉时锁文件会留下来；只靠 EEXIST 判断会让工作区永久卡住。
// 这里在冲突时判断持有者是否还活着：pid 已消失、或锁文件空置超过 60 秒，都按遗留锁处理。
const holderAlive = pid => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
};

const staleLock = async path => {
  try {
    const info = JSON.parse(await readFile(path, 'utf8'));
    if (info && Number.isInteger(Number(info.pid))) return !holderAlive(Number(info.pid));
  } catch { /* 空文件或损坏：看时间戳 */ }
  try { return Date.now() - (await stat(path)).mtimeMs > 60000; } catch { return true; }
};

export async function acquireMutation(root){
 for(const part of ['data','data/private']){try{if((await lstat(join(root,part))).isSymbolicLink())throw new Error('拒绝通过符号链接写入私有数据')}catch(e){if(e.code!=='ENOENT')throw e}}
 const jobs=await readdir(join(root,'data/private/delete-jobs')).catch(e=>{if(e.code==='ENOENT')return [];throw e});if(jobs.length)throw Object.assign(new Error('存在未完成的删除任务，请检查恢复记录后再操作'),{status:409});
 const dir=join(root,'data/private');await mkdir(dir,{recursive:true});const path=join(dir,'mutation.lock');
 let file;
 for(let attempt=0;attempt<2;attempt+=1){
  try{file=await open(path,'wx');break}
  catch(e){
   if(e.code!=='EEXIST')throw e;
   if(attempt===1||!(await staleLock(path)))throw Object.assign(new Error('工作区正在写入或有未完成的操作，请稍后重试；异常退出后请检查 mutation.lock'),{status:409});
   await unlink(path).catch(()=>{});
  }
 }
 await file.writeFile(JSON.stringify({pid:process.pid,started_at:new Date().toISOString()}));await file.close();
 return ()=>unlink(path);
}
