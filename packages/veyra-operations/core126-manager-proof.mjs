import {UUID,hash,text,integer,publicContainer,unavailable,freeze} from './core126-image-contract.mjs';
/** Wire only inside the original authenticated manager, using its private Docker request owner. */
export function createCore126ManagerProofProducer({docker,now=Date.now}){
 if(typeof docker!=='function')unavailable('original Docker owner missing');
 const get=async path=>{const r=await docker('GET',path);if(r?.status!==200||!r.data)unavailable('original daemon observation');return r.data;};
 return Object.freeze({async observe(runtimeId){
  if(!UUID.test(runtimeId??''))unavailable('runtime identity');
  const start=now(),name='ingenium-runtime-'+runtimeId.replaceAll('-',''),path='/containers/'+encodeURIComponent(name)+'/json';
  const daemon=await get('/info'),first=publicContainer(await get(path));
  const image=await get('/images/'+encodeURIComponent(first.imageId)+'/json');
  const final=publicContainer(await get(path)),lastDaemon=await get('/info'),end=now();
  if(!text(daemon.ID)||lastDaemon.ID!==daemon.ID||image.Id!==first.imageId||hash(first)!==hash(final)||!integer(start)||!integer(end)||end<start||end-start>=5000)unavailable('daemon/parent/image changed during observation');
  return freeze({schemaVersion:1,kind:'original-manager-core126-parent-v1',observedAt:start,expiresAt:start+5000,daemonId:daemon.ID,
   hostId:'docker-daemon:'+hash('veyra-docker-host-v1\0'+daemon.ID),parent:final,image:{id:image.Id,config:{User:image.Config?.User,WorkingDir:image.Config?.WorkingDir,Entrypoint:image.Config?.Entrypoint,Cmd:image.Config?.Cmd??null}}});
 }});
}
