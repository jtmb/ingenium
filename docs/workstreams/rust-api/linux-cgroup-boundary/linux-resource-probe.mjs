import {readFileSync,readlinkSync,lstatSync,statSync,statfsSync} from 'node:fs';
import {resolve,relative,dirname,sep} from 'node:path';
import {createHash} from 'node:crypto';
const fail=code=>{throw Object.assign(new Error(code),{code});};
const bounded=(path,max=65536)=>{const value=readFileSync(path,'utf8');if(Buffer.byteLength(value)>max)fail('CPU_KERNEL_FACT_LIMIT');return value;};
const uint=text=>{if(!/^(0|[1-9][0-9]*)$/.test(text))fail('CPU_KERNEL_FACT_INVALID');const n=BigInt(text);if(n>BigInt(Number.MAX_SAFE_INTEGER))fail('CPU_KERNEL_FACT_RANGE');return Number(n);};
const limit=text=>text==='max'?null:uint(text);
const decode=value=>value.replace(/\\(040|011|012|134)/g,(_,v)=>String.fromCharCode(parseInt(v,8)));
function cpuSet(value){
 if(!value.trim())fail('CPU_CPUSET_UNKNOWN');const ranges=value.trim().split(',').map(part=>{const m=part.match(/^(\d+)(?:-(\d+))?$/);if(!m)fail('CPU_CPUSET_INVALID');const a=uint(m[1]),b=m[2]===undefined?a:uint(m[2]);if(b<a||b>1048575)fail('CPU_CPUSET_INVALID');return [a,b];}).sort((a,b)=>a[0]-b[0]);
 let count=0,last=-1;for(const [a,b]of ranges){if(a<=last)fail('CPU_CPUSET_INVALID');count+=b-a+1;last=b;}return count;
}
const identity=path=>{const s=lstatSync(path,{bigint:true});if(!s.isDirectory()||s.isSymbolicLink())fail('CPU_CGROUP_CUSTODY');return {path,device:String(s.dev),inode:String(s.ino)};};
const rootControlFiles=['memory.max','memory.current','pids.max','pids.current','cpu.max'];
function mountRecords(text){return text.trim().split('\n').map(line=>{
 const parts=line.split(' - '),fields=parts[0].split(' '),fs=parts[1]?.split(' ');
 if(parts.length!==2||fields.length<6||fs.length<3||!/^\d+$/.test(fields[0])||!/^\d+$/.test(fields[1])||!/^\d+:\d+$/.test(fields[2]))fail('CPU_MOUNT_FACT_INVALID');
 const root=decode(fields[3]),point=decode(fields[4]);if(!root.startsWith('/')||!point.startsWith('/')||[root,point].some(p=>p.split('/').some(v=>v==='.'||v==='..')))fail('CPU_MOUNT_FACT_INVALID');
 return {fields,root,point,type:fs[0]};
});}
function controllers(path){const raw=bounded(path,4096),names=raw.trim().split(/\s+/);if(names.some(v=>!v||!(/^[a-z][a-z0-9_]*$/).test(v))||new Set(names).size!==names.length||!['cpu','memory','pids'].every(v=>names.includes(v)))fail('CPU_GLOBAL_CONTROLLERS_UNKNOWN');return raw;}
/** Strict Linux global-root evidence, not a missing-file fallback or a finite resource value. */
function globalControllerBoundary(mount,records,namespace){
 const root=identity(mount.point);
 if(mount.root!=='/'||root.inode!=='1'||namespace!=='cgroup:[4026531835]')fail('CPU_GLOBAL_ROOT_UNPROVEN');
 // Linux PROC_CGROUP_INIT_INO=0xeffffffb; verify the actual nsfs object, not just link text.
 const ns=statSync('/proc/self/ns/cgroup',{bigint:true});
 if(ns.ino!==4026531835n||BigInt(statfsSync('/proc/self/ns/cgroup',{bigint:true}).type)!==0x6e736673n)fail('CPU_GLOBAL_ROOT_UNPROVEN');
 if(BigInt(statfsSync(mount.point,{bigint:true}).type)!==0x63677270n)fail('CPU_CGROUP_FILESYSTEM_UNKNOWN');
 if(records.some(r=>(r.point===mount.point&&r!==mount)||r.point.startsWith(mount.point+'/')))fail('CPU_CGROUP_MASKED');
 const procs=records.filter(r=>r.point==='/proc');if(procs.length!==1||procs[0].root!=='/'||procs[0].type!=='proc')fail('CPU_PROC_ORIGINAL_UNKNOWN');
 const protectedPaths=['/proc/self/cgroup','/proc/self/mountinfo','/proc/self/ns/cgroup','/proc/'+process.pid+'/cgroup','/proc/'+process.pid+'/mountinfo','/proc/'+process.pid+'/ns/cgroup','/proc/meminfo','/proc/sys/kernel/random/boot_id'];
 if(records.some(r=>r.point!=='/proc'&&protectedPaths.some(p=>p===r.point||p.startsWith(r.point+'/'))))fail('CPU_PROC_MASKED');
 for(const path of ['/proc/self/cgroup','/proc/self/mountinfo','/proc/meminfo','/proc/sys/kernel/random/boot_id'])if(BigInt(statfsSync(path,{bigint:true}).type)!==0x9fa0n)fail('CPU_PROC_ORIGINAL_UNKNOWN');
 for(const name of rootControlFiles){try{lstatSync(mount.point+'/'+name);fail('CPU_GLOBAL_CONTROLLER_LAYOUT_UNKNOWN');}catch(error){if(error.code!=='ENOENT')throw error;}}
 return {kind:'global-controller-root',...root,namespaceInode:String(ns.ino),namespaceDevice:String(ns.dev),controllers:controllers(mount.point+'/cgroup.controllers'),subtreeControl:controllers(mount.point+'/cgroup.subtree_control')};
}
/** Concrete read-only Linux kernel probe. No injectable capacity/positive-admission port. */
export function readLinuxCpuCapacity(){
 if(process.platform!=='linux')fail('CPU_LINUX_RESOURCES_REQUIRED');
 const membership=bounded('/proc/self/cgroup'),mounts=bounded('/proc/self/mountinfo',1048576),namespace=readlinkSync('/proc/self/ns/cgroup');
 if(!/^cgroup:\[[0-9]+\]$/.test(namespace))fail('CPU_CGROUP_NAMESPACE_UNKNOWN');
 const records=membership.trim().split('\n');if(records.length!==1||!records[0].startsWith('0::/'))fail('CPU_UNIFIED_CGROUP_REQUIRED');
 const member=records[0].slice(3);if(member.includes('\0')||member.split('/').some(p=>p==='..'||p==='.'))fail('CPU_CGROUP_PATH_INVALID');
 const mountsParsed=mountRecords(mounts),candidates=mountsParsed.filter(r=>r.type==='cgroup2');
 if(candidates.length!==1)fail('CPU_CGROUP_MOUNT_AMBIGUOUS');
 const mount=candidates[0],fields=mount.fields,mountRoot=mount.root,mountPoint=mount.point;
 if(mountPoint!=='/sys/fs/cgroup'||!mountRoot.startsWith('/'))fail('CPU_FIXED_CGROUP_MOUNT_REQUIRED');
 const suffix=relative(mountRoot,member);if(suffix.startsWith('..')||suffix.startsWith('/'))fail('CPU_CGROUP_PATH_UNRESOLVED');
 const leaf=resolve(mountPoint,suffix);if(leaf!==mountPoint&&!leaf.startsWith(mountPoint+sep))fail('CPU_CGROUP_PATH_INVALID');
 if(BigInt(statfsSync(mountPoint,{bigint:true}).type)!==0x63677270n)fail('CPU_CGROUP_FILESYSTEM_UNKNOWN');
 const chain=[];let path=leaf,memoryHeadroom=Infinity,pidsHeadroom=Infinity,cpuMilli=Infinity,boundary=null;
 while(true){
  if(chain.length>=64)fail('CPU_CGROUP_DEPTH_LIMIT');
  const original=identity(path);let memoryMax,memoryCurrent,pidsMax,pidsCurrent,cpu;
  try{
   memoryMax=limit(bounded(path+'/memory.max',128).trim());memoryCurrent=uint(bounded(path+'/memory.current',128).trim());
   pidsMax=limit(bounded(path+'/pids.max',128).trim());pidsCurrent=uint(bounded(path+'/pids.current',128).trim());
   cpu=bounded(path+'/cpu.max',128).trim().split(/\s+/);
  }catch(error){
   if(error.code!=='ENOENT'||path!==mountPoint)throw error;
   boundary=globalControllerBoundary(mount,mountsParsed,namespace);
   chain.push({...original,kind:'global-controller-root',memoryMax:null,memoryCurrent:null,pidsMax:null,pidsCurrent:null,cpuMilli:null});break;
  }
  if(cpu.length!==2)fail('CPU_QUOTA_UNKNOWN');
  const quota=limit(cpu[0]),period=uint(cpu[1]);if(period===0||quota===0)fail('CPU_QUOTA_INVALID');
  const milli=quota===null?null:Number(BigInt(quota)*1000n/BigInt(period));
  if(memoryMax!==null)memoryHeadroom=Math.min(memoryHeadroom,Math.max(0,memoryMax-memoryCurrent));
  if(pidsMax!==null)pidsHeadroom=Math.min(pidsHeadroom,Math.max(0,pidsMax-pidsCurrent));
  if(milli!==null)cpuMilli=Math.min(cpuMilli,milli);
  chain.push({...original,memoryMax,memoryCurrent,pidsMax,pidsCurrent,cpuMilli:milli});
  if(path===mountPoint)break;path=dirname(path);if(path!==mountPoint&&!path.startsWith(mountPoint+sep))fail('CPU_CGROUP_PATH_INVALID');
 }
 if(!Number.isFinite(memoryHeadroom)||!Number.isFinite(pidsHeadroom))fail('CPU_FINITE_CGROUP_CAPACITY_REQUIRED');
 const cpus=cpuSet(bounded(leaf+'/cpuset.cpus.effective',32768));cpuMilli=Math.min(cpuMilli,cpus*1000);
 const meminfo=bounded('/proc/meminfo'),available=meminfo.match(/^MemAvailable:\s+([0-9]+) kB$/m),total=meminfo.match(/^MemTotal:\s+([0-9]+) kB$/m);
 if(!available||!total)fail('CPU_HOST_MEMORY_UNKNOWN');const hostAvailable=uint(available[1])*1024,hostTotal=uint(total[1])*1024;
 if(!Number.isSafeInteger(hostAvailable)||!Number.isSafeInteger(hostTotal)||hostAvailable>hostTotal)fail('CPU_HOST_MEMORY_INVALID');
 const cpuStat=bounded(leaf+'/cpu.stat');const usage=cpuStat.match(/^usage_usec ([0-9]+)$/m);if(!usage)fail('CPU_CPU_USAGE_UNKNOWN');
 for(const node of chain)if(JSON.stringify(identity(node.path))!==JSON.stringify({path:node.path,device:node.device,inode:node.inode}))fail('CPU_CGROUP_IDENTITY_CHANGED');
 if(bounded('/proc/self/cgroup')!==membership||bounded('/proc/self/mountinfo',1048576)!==mounts||readlinkSync('/proc/self/ns/cgroup')!==namespace)fail('CPU_CGROUP_IDENTITY_CHANGED');
 if(boundary&&JSON.stringify(globalControllerBoundary(mount,mountsParsed,namespace))!==JSON.stringify(boundary))fail('CPU_GLOBAL_ROOT_IDENTITY_CHANGED');
 const boot=bounded('/proc/sys/kernel/random/boot_id',128).trim();if(!/^[a-f0-9-]{36}$/.test(boot))fail('CPU_KERNEL_BOOT_UNKNOWN');
 const original={boot,namespace,mountId:fields[0],mountRoot,mountPoint,chain:chain.map(({path,device,inode})=>({path,device,inode})),...(boundary?{globalControllerBoundary:boundary}:{})};
 return Object.freeze({identity:createHash('sha256').update(JSON.stringify(original)).digest('hex'),original,memoryHeadroom:Math.min(memoryHeadroom,hostAvailable),pidsHeadroom,cpuMilli,cpus,cpuUsageUsec:uint(usage[1]),hostAvailable,chain});
}
