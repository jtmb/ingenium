import * as fs from "node:fs";
import {createHash} from "node:crypto";
const ROOT="/run/ingenium-runtime",JOB=ROOT+"/job",CONFIG=JOB+"/config";
const allowed=new Set([ROOT+"/capability",JOB+"/material.json",CONFIG+"/opencode.json"]);
const deny=()=>{throw Error("Original JobRun private files unavailable");};
export function assertJobPrivateTmpfs(io=fs){
 if(process.getuid?.()!==1000)deny();const mount=io.readFileSync('/proc/self/mountinfo','utf8').split('\n').filter(line=>line.split(' ')[4]===ROOT);if(mount.length!==1||!mount[0].includes(' - tmpfs '))deny();
 const st=io.lstatSync(ROOT);if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==1000||(st.mode&0o777)!==0o700||io.realpathSync(ROOT)!==ROOT)deny();
}
function directory(path,io){if(!io.existsSync(path))io.mkdirSync(path,{mode:0o700});const s=io.lstatSync(path);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==1000||(s.mode&0o777)!==0o700||io.realpathSync(path)!==path)deny();}
export function prepareJobPrivateDirectories(io=fs){assertJobPrivateTmpfs(io);directory(JOB,io);directory(CONFIG,io);if(io.readdirSync(JOB).some(p=>p!=="config")||io.readdirSync(CONFIG).length)deny();}
export function writeOriginalJobPrivate(path,value,io=fs){
 if(!allowed.has(path))deny();assertJobPrivateTmpfs(io);const parent=path.slice(0,path.lastIndexOf('/'));directory(parent,io);const bytes=Buffer.from(typeof value==='string'?value:JSON.stringify(value));if(bytes.length>384*1024)deny();let fd;
 try{fd=io.openSync(path,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);io.writeFileSync(fd,bytes);io.fsyncSync(fd);const stat=io.fstatSync(fd),name=io.lstatSync(path);if(!stat.isFile()||stat.nlink!==1||stat.uid!==1000||(stat.mode&0o777)!==0o600||stat.ino!==name.ino||stat.dev!==name.dev||name.isSymbolicLink()||io.realpathSync(path)!==path)deny();}finally{if(fd!==undefined)io.closeSync(fd);}
}
export function assertOriginalJobStaticFiles(profile,expectedPaths,io=fs){
 if(!profile||!/^sha256:[a-f0-9]{64}$/.test(profile.imageId)||!Array.isArray(profile.files)||profile.files.length!==expectedPaths.length||new Set(profile.files.map(f=>f.path)).size!==expectedPaths.length||expectedPaths.some(p=>!profile.files.some(f=>f.path===p)))deny();
 for(const row of profile.files){if(!/^[a-f0-9]{64}$/.test(row.sha256)||!Number.isSafeInteger(row.bytes)||row.bytes<=0||io.realpathSync(row.path)!==row.path)deny();let fd;try{fd=io.openSync(row.path,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);const a=io.fstatSync(fd);if(!a.isFile()||a.uid!==0||a.gid!==0||a.nlink!==1||(a.mode&0o022)!==0||a.size!==row.bytes)deny();const hash=createHash('sha256'),buf=Buffer.alloc(65536);let total=0;while(true){const n=io.readSync(fd,buf,0,buf.length,null);if(!n)break;total+=n;if(total>row.bytes)deny();hash.update(buf.subarray(0,n));}const b=io.fstatSync(fd),name=io.lstatSync(row.path);if(total!==row.bytes||hash.digest('hex')!==row.sha256||a.ino!==b.ino||a.dev!==b.dev||a.size!==b.size||a.mtimeMs!==b.mtimeMs||a.ctimeMs!==b.ctimeMs||a.ino!==name.ino||a.dev!==name.dev||name.isSymbolicLink())deny();}finally{if(fd!==undefined)io.closeSync(fd);}}
 return true;
}
