// Regression for the actual 1777/read-only AtomicWriter mount on Kubernetes.
// Explicit filesystem metadata doubles; no credentials or network operations.
import {beforeEach,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({readOnly:true,directoryUid:0,fileUid:0}));
vi.mock('node:fs',async()=>{
 const actual=await vi.importActual<typeof import('node:fs')>('node:fs');
 const {rootCertificates}=await import('node:tls');
 const original='/var/run/secrets/kubernetes.io/serviceaccount',base='/run/secrets/kubernetes.io/serviceaccount';
 const values:Record<string,string>={namespace:'ingenium', 'ca.crt':rootCertificates[0]!,token:'unit.only.token'};
 return {...actual,
  realpathSync:(path:string)=>path===original?base:path.startsWith(original+'/')?base+'/..epoch/'+path.slice(original.length+1):actual.realpathSync(path),
  statSync:(path:string)=>{
   if(path===base)return {uid:m.directoryUid,mode:0o41777,isDirectory:()=>true};
   if(path.startsWith(base+'/..epoch/')){const bytes=Buffer.byteLength(values[path.split('/').at(-1)!]!);return {uid:m.fileUid,mode:0o100444,nlink:1,size:bytes,dev:1,ino:2,mtimeMs:1,ctimeMs:1,isFile:()=>true};}
   return actual.statSync(path);
  },
  readFileSync:(path:string,encoding?:unknown)=>{
   if(path==='/proc/self/mountinfo')return '7146 7133 0:274 / '+base+' '+(m.readOnly?'ro':'rw')+',relatime - tmpfs tmpfs rw,size=4587520k,inode64\n';
   if(path.startsWith(base+'/..epoch/'))return Buffer.from(values[path.split('/').at(-1)!]!);
   return actual.readFileSync(path,encoding as never);
  },
 };
});
import {KubernetesApiClient} from '../lib/kubernetes/api-client.js';
beforeEach(()=>{m.readOnly=true;m.directoryUid=0;m.fileUid=0;vi.stubEnv('KUBERNETES_SERVICE_HOST','10.96.0.1');vi.stubEnv('KUBERNETES_SERVICE_PORT_HTTPS','443');});
it('accepts root-owned credential files on the actual read-only projected tmpfs mount',()=>{expect(KubernetesApiClient.inCluster().namespace).toBe('ingenium');});
it('rejects a writable projected mount with the same permissive directory mode',()=>{m.readOnly=false;expect(()=>KubernetesApiClient.inCluster()).toThrow('KUBERNETES_CREDENTIAL_DIRECTORY');});
it('rejects a non-root directory even when its mount is read-only',()=>{m.directoryUid=1000;expect(()=>KubernetesApiClient.inCluster()).toThrow('KUBERNETES_CREDENTIAL_DIRECTORY');});
it('preserves the root-owned, non-writable credential file requirement',()=>{m.fileUid=1000;expect(()=>KubernetesApiClient.inCluster()).toThrow('KUBERNETES_CREDENTIAL_FILE');});
