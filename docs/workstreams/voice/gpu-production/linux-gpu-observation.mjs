import {constants,openSync,closeSync,readSync,fstatSync,lstatSync,statfsSync,realpathSync,readdirSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const fail=code=>{throw Object.assign(Error(code),{code});};
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function read(path,max=256){
 let fd;try{
  fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_CLOEXEC);
  const before=fstatSync(fd,{bigint:true});if(!before.isFile()||before.uid!==0n||Number(before.mode)&0o022)fail('GPU_KERNEL_FILE_CUSTODY');
  const bytes=Buffer.alloc(max+1);let count=0;
  while(count<bytes.length){const n=readSync(fd,bytes,count,bytes.length-count,null);if(!n)break;count+=n;}
  const after=fstatSync(fd,{bigint:true});if(count>max||before.dev!==after.dev||before.ino!==after.ino)fail('GPU_KERNEL_FILE_CHANGED');
  return bytes.subarray(0,count).toString('utf8').trim();
 }finally{if(fd!==undefined)closeSync(fd);}
}
const uint=text=>{if(!/^(0|[1-9][0-9]*)$/.test(text))fail('GPU_KERNEL_VALUE');const n=BigInt(text);if(n>BigInt(Number.MAX_SAFE_INTEGER))fail('GPU_KERNEL_RANGE');return Number(n);};
function deviceFacts(path){
 if(!path.startsWith('/sys/devices/')||!/[0-9a-f]{4}:[0-9a-f]{2}:[0-9a-f]{2}\.[0-7]$/.test(path)||BigInt(statfsSync(path,{bigint:true}).type)!==0x62656572n)fail('GPU_DEVICE_DOMAIN_UNKNOWN');
 const s=lstatSync(path,{bigint:true});if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==0n||Number(s.mode)&0o022)fail('GPU_DEVICE_CUSTODY');
 if(read(path+'/vendor')!=='0x1002')return null;
 if(realpathSync(path+'/driver')!=='/sys/bus/pci/drivers/amdgpu')fail('GPU_PROVIDER_UNSUPPORTED');
 return {path,device:String(s.dev),inode:String(s.ino)};
}
/** Fixed kernel-only reads. No device fd/ioctl/library/model imports, sysfs
 * writes, subprocess, path arguments, injected fs, allocation or health port.
 * Returned data is NOT host-wide coverage, a lease or provider qualification.
 * WSL is rejected because guest accounting cannot establish Windows occupancy.
 */
export function readLinuxAmdVramObservations(){
 if(process.platform!=='linux')fail('GPU_NATIVE_LINUX_OBSERVATION_REQUIRED');
 if(BigInt(statfsSync('/sys',{bigint:true}).type)!==0x62656572n)fail('GPU_SYSFS_REQUIRED');
 const release=readFileSync('/proc/sys/kernel/osrelease','utf8').trim();if(release.length>256||/microsoft|wsl/i.test(release))fail('GPU_HOST_ACCOUNTING_DOMAIN_UNKNOWN');
 const bootId=readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim();if(!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(bootId))fail('GPU_BOOT_ID_UNKNOWN');
 const entries=readdirSync('/sys/class/drm');if(entries.length>256)fail('GPU_DEVICE_ENUMERATION_BOUND');
 const names=entries.filter(name=>/^renderD[0-9]{1,6}$/.test(name)).sort();if(names.length>32)fail('GPU_DEVICE_ENUMERATION_BOUND');
 const observations=[],seen=new Set();
 for(const name of names){
  const sampleStartedAt=Date.now(),path=realpathSync('/sys/class/drm/'+name+'/device');
  // Non-AMD devices are unsupported observations, never mapped to a default GPU.
  const before=deviceFacts(path);if(!before)continue;
  if(seen.has(path))fail('GPU_DEVICE_IDENTITY_AMBIGUOUS');seen.add(path);
  const total1=uint(read(path+'/mem_info_vram_total')),used1=uint(read(path+'/mem_info_vram_used'));
  const used2=uint(read(path+'/mem_info_vram_used')),total2=uint(read(path+'/mem_info_vram_total'));
  const after=deviceFacts(path),observedAt=Date.now();
  if(JSON.stringify(before)!==JSON.stringify(after)||total1!==total2||total1===0||used1>total1||used2>total1||observedAt<sampleStartedAt||observedAt-sampleStartedAt>250)fail('GPU_DEVICE_OBSERVATION_CHANGED');
  const usedBytes=Math.max(used1,used2);
  observations.push(Object.freeze({deviceIdentity:hash([bootId,release,before]),bootId,sampleStartedAt,observedAt,totalBytes:total1,usedBytes,availableBytes:total1-usedBytes,
   scope:'visible-amdgpu-driver',observationOnly:true}));
 }
 return Object.freeze(observations);
}
