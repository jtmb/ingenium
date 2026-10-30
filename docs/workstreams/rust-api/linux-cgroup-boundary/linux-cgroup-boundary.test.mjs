import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import * as path from 'node:path';import * as crypto from 'node:crypto';import {SourceTextModule,SyntheticModule} from 'node:vm';
const source=readFileSync(new URL('linux-resource-probe.mjs',import.meta.url),'utf8'),root='/sys/fs/cgroup',controlFiles=['memory.max','memory.current','pids.max','pids.current','cpu.max'];
async function fixture(action){
 const files=new Map(),dirs=new Map([[root,1n],[root+'/parent',42n],[root+'/parent/leaf',43n]]);
 const state={namespace:'cgroup:[4026531835]',namespaceInode:4026531835n,namespaceDevice:4n,namespaceFs:0x6e736673n,cgroupFs:0x63677270n,procFs:0x9fa0n,onRead:null,readCounts:new Map(),denied:new Set()};
 const write=(p,v)=>files.set(p,v);
 write('/proc/self/cgroup','0::/parent/leaf\n');write('/proc/self/mountinfo','10 1 0:59 / /proc rw - proc proc rw\n20 1 0:23 / /sys/fs/cgroup rw - cgroup2 cgroup2 rw,nsdelegate\n');
 write('/proc/meminfo','MemTotal: 16384 kB\nMemAvailable: 2 kB\n');write('/proc/sys/kernel/random/boot_id','00000000-1111-4111-8111-111111111111\n');
 write(root+'/cgroup.controllers','cpuset cpu io memory pids\n');write(root+'/cgroup.subtree_control','cpuset cpu io memory pids\n');
 for(const [node,values] of [['/parent',['8192','2048','32','8','100000 100000']],['/parent/leaf',['4096','1024','64','4','200000 100000']]])for(let i=0;i<controlFiles.length;i++)write(root+node+'/'+controlFiles[i],values[i]+'\n');
 write(root+'/parent/leaf/cpuset.cpus.effective','0-3\n');write(root+'/parent/leaf/cpu.stat','usage_usec 123\n');
 const error=(code,p)=>Object.assign(Error(code+' '+p),{code});
 const fakeFs={
  readFileSync(p){const n=(state.readCounts.get(p)??0)+1;state.readCounts.set(p,n);state.onRead?.(p,n);if(state.denied.has(p))throw error('EACCES',p);if(!files.has(p))throw error('ENOENT',p);return files.get(p);},
  readlinkSync(p){assert.equal(p,'/proc/self/ns/cgroup');return state.namespace;},
  lstatSync(p){if(state.denied.has(p))throw error('EACCES',p);if(dirs.has(p))return {ino:dirs.get(p),dev:23n,isDirectory:()=>true,isSymbolicLink:()=>false};if(files.has(p))return {ino:90n,dev:23n,isDirectory:()=>false,isSymbolicLink:()=>false};throw error('ENOENT',p);},
  statSync(p){assert.equal(p,'/proc/self/ns/cgroup');return {ino:state.namespaceInode,dev:state.namespaceDevice};},
  statfsSync(p){return {type:p==='/proc/self/ns/cgroup'?state.namespaceFs:p.startsWith('/proc/')||p==='/proc'?state.procFs:state.cgroupFs};},
 };
 const synth=values=>new SyntheticModule(Object.keys(values),function(){for(const[k,v]of Object.entries(values))this.setExport(k,v);});
 const m=new SourceTextModule(source,{identifier:'linux-cgroup-boundary-fixture.mjs'});
 await m.link(name=>{if(name==='node:fs')return synth(fakeFs);if(name==='node:path')return synth(path);if(name==='node:crypto')return synth(crypto);throw Error('Unexpected dependency '+name);});await m.evaluate();
 await action({files,dirs,state,write,read:()=>m.namespace.readLinuxCpuCapacity(),addMount:line=>write('/proc/self/mountinfo',files.get('/proc/self/mountinfo')+line+'\n')});
}
test('true global boundary omits no finite constraints; finite leaf/ancestor and host pressure supply capacity',()=>fixture(({read})=>{
 const f=read();assert.equal(f.chain.length,3);assert.equal(f.memoryHeadroom,2048);assert.equal(f.pidsHeadroom,24);assert.equal(f.cpuMilli,1000);assert.equal(f.cpus,4);
 assert.equal(f.chain[2].kind,'global-controller-root');for(const name of ['memoryMax','memoryCurrent','pidsMax','pidsCurrent','cpuMilli'])assert.equal(f.chain[2][name],null);
 assert.equal(f.original.globalControllerBoundary.inode,'1');assert.equal(f.original.globalControllerBoundary.namespaceInode,'4026531835');
}));
test('unrelated nsfs handle roots retain legitimate mountinfo without weakening relevant path/mask checks',()=>fixture(({addMount,read})=>{
 addMount('30 1 0:4 net:[4026531840] /run/docker/netns/default rw - nsfs nsfs rw');assert.equal(read().memoryHeadroom,2048);
}));
test('global root alone and all-unbounded descendant memory/tasks never become finite admission',async()=>{
 await fixture(({write,read})=>{write('/proc/self/cgroup','0::/\n');assert.throws(read,/FINITE_CGROUP/);});
 for(const key of ['memory.max','pids.max'])await fixture(({write,read})=>{for(const d of ['/parent','/parent/leaf'])write(root+d+'/'+key,'max\n');assert.throws(read,/FINITE_CGROUP/);});
});
test('missing controller/current/quota files in leaf or intermediate ancestors never use root exception',async()=>{
 for(const dir of ['/parent','/parent/leaf'])for(const file of controlFiles)await fixture(({files,read})=>{files.delete(root+dir+'/'+file);assert.throws(read,{code:'ENOENT'});});
});
test('partial, unreadable or malformed global layout cannot turn absence into capacity',async()=>{
 for(const file of controlFiles)await fixture(({write,read})=>{write(root+'/'+file,'max\n');assert.throws(read,/LAYOUT_UNKNOWN|FACT_INVALID/);});
 await fixture(({state,read})=>{state.denied.add(root+'/memory.max');assert.throws(read,{code:'EACCES'});});
 await fixture(({write,read})=>{write(root+'/memory.max','invalid\n');assert.throws(read,/FACT_INVALID/);});
});
test('nested mount root, non-root inode, noninitial namespace, wrong ns/proc/cgroup filesystems refuse boundary',async()=>{
 for(const mutate of [
  f=>{f.write('/proc/self/cgroup','0::/hidden/parent/leaf\n');f.write('/proc/self/mountinfo',f.files.get('/proc/self/mountinfo').replace('0:23 / /sys','0:23 /hidden /sys'));},
  f=>f.dirs.set(root,99n),f=>{f.state.namespace='cgroup:[4026533000]';},f=>{f.state.namespaceInode=4026533000n;},f=>{f.state.namespaceFs=0x9fa0n;},f=>{f.state.procFs=0x1021994n;},f=>{f.state.cgroupFs=0x1021994n;},
  f=>f.write('/proc/self/mountinfo',f.files.get('/proc/self/mountinfo').replace(' - proc proc rw',' - tmpfs tmpfs rw')),
 ])await fixture(f=>{mutate(f);assert.throws(f.read,/UNPROVEN|UNKNOWN/);});
 await fixture(({write,read})=>{write('/proc/self/mountinfo','unknown mount metadata\n');assert.throws(read,/MOUNT_FACT_INVALID/);});
});
test('any cgroup submount or masked controller directory/file denies root exception',async()=>{
 for(const point of [root,root+'/memory.max',root+'/parent',root+'/parent/leaf/pids.max'])await fixture(({addMount,read})=>{addMount('30 20 0:99 / '+point+' ro - tmpfs tmpfs ro');assert.throws(read,/CGROUP_MASKED/);});
});
test('masked proc membership/mounts/namespace/host pressure/boot provenance refuse',async()=>{
 for(const point of ['/proc/self','/proc/self/cgroup','/proc/'+process.pid+'/mountinfo','/proc/self/ns/cgroup','/proc/meminfo','/proc/sys/kernel/random/boot_id'])await fixture(({addMount,read})=>{addMount('30 10 0:99 / '+point+' ro - tmpfs tmpfs ro');assert.throws(read,/PROC_MASKED/);});
});
test('root controller availability AND subtree enablement are required, without duplicates or unknown tokens',async()=>{
 for(const name of ['cgroup.controllers','cgroup.subtree_control'])for(const contents of ['cpu memory\n','cpu pids\n','memory pids\n','cpu memory pids pids\n','+cpu memory pids\n'])await fixture(({write,read})=>{write(root+'/'+name,contents);assert.throws(read,/CONTROLLERS_UNKNOWN/);});
});
test('finite ancestor memory/current,pids/current,CPU quota continue constraining leaf under global root',async()=>{
 await fixture(({write,read})=>{write(root+'/parent/memory.max','1024\n');assert.equal(read().memoryHeadroom,0);});
 await fixture(({write,read})=>{write(root+'/parent/pids.max','9\n');assert.equal(read().pidsHeadroom,1);});
 await fixture(({write,read})=>{write(root+'/parent/cpu.max','25000 100000\n');assert.equal(read().cpuMilli,250);});
});
test('root/leaf inode, namespace membership and mount identity races refuse rather than rebase',async()=>{
 for(const mutate of [f=>f.dirs.set(root,2n),f=>f.dirs.set(root+'/parent/leaf',80n),f=>{f.state.namespace='cgroup:[4026533000]';},f=>f.write('/proc/self/cgroup','0::/other\n'),f=>f.write('/proc/self/mountinfo',f.files.get('/proc/self/mountinfo').replace('20 1','21 1'))])await fixture(f=>{f.state.onRead=p=>{if(p.endsWith('/cpu.stat'))mutate(f);};assert.throws(f.read,/IDENTITY_CHANGED/);});
});
test('root controller/nsfs/absence proof is rechecked after capacity reads',async()=>{
 for(const mutate of [f=>f.write(root+'/cgroup.controllers','cpuset cpu memory pids\n'),f=>{f.state.namespaceInode++;},f=>f.write(root+'/memory.max','max\n')])await fixture(f=>{f.state.onRead=p=>{if(p.endsWith('/cpu.stat'))mutate(f);};assert.throws(f.read,/ROOT_IDENTITY_CHANGED|UNPROVEN|LAYOUT_UNKNOWN/);});
});
test('original fully present finite non-global hierarchy keeps its existing behavior',()=>fixture(({write,dirs,state,read})=>{
 for(const [i,key]of controlFiles.entries())write(root+'/'+key,['max','0','max','0','max 100000'][i]+'\n');dirs.set(root,500n);state.namespace='cgroup:[4026533000]';state.namespaceInode=4026533000n;
 const f=read();assert.equal(f.memoryHeadroom,2048);assert.equal(f.pidsHeadroom,24);assert.equal(f.cpuMilli,1000);assert.equal(f.original.globalControllerBoundary,undefined);
}));
