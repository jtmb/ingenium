import {readFileSync,readlinkSync,lstatSync,statfsSync} from 'node:fs';
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
/** Concrete read-only Linux kernel probe. No injectable capacity/positive-admission port. */
export function readLinuxCpuCapacity(){
 if(process.platform!=='linux')fail('CPU_LINUX_RESOURCES_REQUIRED');
 const membership=bounded('/proc/self/cgroup'),mounts=bounded('/proc/self/mountinfo',1048576),namespace=readlinkSync('/proc/self/ns/cgroup');
 if(!/^cgroup:\[[0-9]+\]$/.test(namespace))fail('CPU_CGROUP_NAMESPACE_UNKNOWN');
 const records=membership.trim().split('\n');if(records.length!==1||!records[0].startsWith('0::/'))fail('CPU_UNIFIED_CGROUP_REQUIRED');
 const member=records[0].slice(3);if(member.includes('\0')||member.split('/').some(p=>p==='..'||p==='.'))fail('CPU_CGROUP_PATH_INVALID');
 const candidates=mounts.trim().split('\n').map(line=>line.split(' - ')).filter(parts=>parts.length===2&&parts[1].split(' ')[0]==='cgroup2');
 if(candidates.length!==1)fail('CPU_CGROUP_MOUNT_AMBIGUOUS');
 const fields=candidates[0][0].split(' '),mountRoot=decode(fields[3]),mountPoint=decode(fields[4]);
 if(mountPoint!=='/sys/fs/cgroup'||!mountRoot.startsWith('/'))fail('CPU_FIXED_CGROUP_MOUNT_REQUIRED');
 const suffix=relative(mountRoot,member);if(suffix.startsWith('..')||suffix.startsWith('/'))fail('CPU_CGROUP_PATH_UNRESOLVED');
 const leaf=resolve(mountPoint,suffix);if(leaf!==mountPoint&&!leaf.startsWith(mountPoint+sep))fail('CPU_CGROUP_PATH_INVALID');
 if(BigInt(statfsSync(mountPoint,{bigint:true}).type)!==0x63677270n)fail('CPU_CGROUP_FILESYSTEM_UNKNOWN');
 const chain=[];let path=leaf,memoryHeadroom=Infinity,pidsHeadroom=Infinity,cpuMilli=Infinity;
 while(true){
  if(chain.length>=64)fail('CPU_CGROUP_DEPTH_LIMIT');
  const original=identity(path),memoryMax=limit(bounded(path+'/memory.max',128).trim()),memoryCurrent=uint(bounded(path+'/memory.current',128).trim());
  const pidsMax=limit(bounded(path+'/pids.max',128).trim()),pidsCurrent=uint(bounded(path+'/pids.current',128).trim());
  const cpu=bounded(path+'/cpu.max',128).trim().split(/\s+/);if(cpu.length!==2)fail('CPU_QUOTA_UNKNOWN');
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
 const boot=bounded('/proc/sys/kernel/random/boot_id',128).trim();if(!/^[a-f0-9-]{36}$/.test(boot))fail('CPU_KERNEL_BOOT_UNKNOWN');
 const original={boot,namespace,mountId:fields[0],mountRoot,mountPoint,chain:chain.map(({path,device,inode})=>({path,device,inode}))};
 return Object.freeze({identity:createHash('sha256').update(JSON.stringify(original)).digest('hex'),original,memoryHeadroom:Math.min(memoryHeadroom,hostAvailable),pidsHeadroom,cpuMilli,cpus,cpuUsageUsec:uint(usage[1]),hostAvailable,chain});
}
