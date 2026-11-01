#!/usr/bin/env python3
"""Build Veyra Linux OCI images from current compiled artifacts and pinned runtime layers.

No daemon import or deployment. Reuses the immutable OS/tool/browser input blobs;
application files are streamed once into a new layer, without a dependency copy.
"""
from pathlib import Path
import argparse,base64,copy,datetime,gzip,hashlib,importlib.util,io,json,os,posixpath,re,subprocess,tarfile,time
from registry_image_reader import RegistryImageReader
from registry_layer_inventory import _BoundedTarInfo,_InflatedHash
from oci_artifact_layer import write_layer

PIN='sha256:792f18c3bece144028df8b79772b4928e73c4ff2e1ef625f20ce85ca796d9e8b'
LAYERS=list(range(9))+[17,18,19,21,59,60,61]
OWNER='01a188fc-d3ed-7dc2-ab95-e0eed8a793ec'
encode=lambda value:json.dumps(value,sort_keys=True,separators=(',',':')).encode()
digest=lambda value:'sha256:'+hashlib.sha256(value).hexdigest()
def need(value,why):
 if not value:raise RuntimeError(why)
def command(args,**kwargs):
 q=subprocess.run(args,check=True,capture_output=True,**kwargs);return q.stdout
def module(name,file):
 spec=importlib.util.spec_from_file_location(name,file);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
def metadata_files(reader,image,index,names):
 selected={};description=image['manifest']['layers'][index]
 with reader.blob(description)as compressed:
  with gzip.GzipFile(fileobj=compressed,mode='rb')as zipped:
   raw=_InflatedHash(zipped,None)
   with tarfile.open(fileobj=raw,mode='r|',tarinfo=_BoundedTarInfo)as archive:
    while True:
     item=archive.next()
     if item is None:break
     path='/'+item.name.lstrip('./')
     if path in names:
      need(item.isfile()and item.size<2*1024**2 and path not in selected,'Unexpected image metadata member')
      with archive.extractfile(item)as source:selected[path]=source.read(item.size+1)
      need(len(selected[path])==item.size,'Image metadata truncated')
     archive.members.clear()
    while tail:=archive.fileobj.read(65536):need(not any(tail),'Unexpected layer tail')
   need('sha256:'+raw.hash.hexdigest()==image['config']['rootfs']['diff_ids'][index],'Layer diff ID changed')
  while compressed.read(65536):pass
  compressed.verify()
 need(set(selected)==set(names),'Required image metadata absent')
 return selected
def tar_bytes(entries,epoch):
 target=io.BytesIO()
 with tarfile.open(fileobj=target,mode='w',format=tarfile.PAX_FORMAT)as archive:
  for name,value,mode,uid,gid,kind in entries:
   member=tarfile.TarInfo(name.lstrip('/'));member.mtime=epoch;member.uid=uid;member.gid=gid;member.mode=mode
   if kind=='directory':member.type=tarfile.DIRTYPE;archive.addfile(member)
   elif kind=='symlink':member.type=tarfile.SYMTYPE;member.linkname=value;archive.addfile(member)
   else:member.size=len(value);archive.addfile(member,io.BytesIO(value))
 raw=target.getvalue();body=gzip.compress(raw,compresslevel=6,mtime=0)
 return body,{'mediaType':'application/vnd.oci.image.layer.v1.tar+gzip','digest':digest(body),'size':len(body)},digest(raw)

def main():
 parser=argparse.ArgumentParser(description=__doc__)
 parser.add_argument('--phase-root',type=Path,required=True)
 parser.add_argument('--source-manifest',type=Path,required=True)
 parser.add_argument('--frontend-build',type=int,default=25,help='Completed frontend build receipt to package')
 parser.add_argument('--role',choices=['compatibility','control-plane','user-runtime','runtime-manager','runtime-gateway'],default='compatibility')
 args=parser.parse_args();p=args.phase_root.resolve();a=Path(__file__).resolve().parents[1];root=p.parents[1]
 need(a==p.parent/'prd-ui-fixes'and root.name=='skill-zen-fix-1792810845','Existing task/source roots required')
 source=json.loads(args.source_manifest.read_text());epoch=source['sourceDateEpoch'];revision=source['revision']
 committed={v['path']:v for v in source['files']}
 need(re.fullmatch('[a-f0-9]{40}',revision)and re.fullmatch('[a-f0-9]{64}',source['sourceSha256']),'Exact source manifest required')
 need(command(['git','rev-parse','HEAD'],cwd=a).decode().strip()==revision,'Source revision changed')
 need(not command(['git','status','--porcelain=v1','--untracked-files=all'],cwd=a).strip(),'Commit the integrated source before building')
 budget=json.loads((p/'coordination/integration/veyra-image-storage.json').read_text())
 need(budget['passed']and time.time()-datetime.datetime.fromisoformat(budget['at'].replace('Z','+00:00')).timestamp()<300,'Fresh image-stage storage preflight required')
 need(budget['stageGrowthBytes']==1288490189 and budget['stage']['task_allocated_bytes']+1288490189<=21474836480,'Image stage exceeds existing task ceiling')
 known=json.loads((p/'coordination/integration/registry-reader-actual-metadata-r486.json').read_text())
 need(known['pinnedImageDigest']==PIN,'Pinned runtime input changed')
 need(sum(known['layers'][n]['size']for n in LAYERS)+2*192*1024**2+32*1024**2<=1288490189,'Complete new producer peak exceeds admitted stage')
 out=p/'runtime/veyra-linux.oci.tar';app_layer=p/'runtime/veyra-application-layer.tar.gz'
 need(not out.exists(),'Previous OCI archive still has a consumer or needs safe cleanup')
 backend_file=p/'evidence/backend-runtime-package-files-r482.json.gz'
 need(hashlib.sha256(backend_file.read_bytes()).hexdigest()=='af59de55397bdef6c9833c7f51d15da7f27df96af4a8f5f20d9dd4a877b99fac','Dependency file plan changed')
 backend=json.loads(gzip.decompress(backend_file.read_bytes()));rows={}
 def add(file,target,mode=None):
  file=Path(file);need(file.resolve()==file and file.is_file()and file.is_relative_to(root),'Build source alias or escape')
  body=file.read_bytes();st=file.stat()
  item={'type':'file','source':str(file.relative_to(root)),'target':target,'bytes':len(body),'sha256':hashlib.sha256(body).hexdigest(),'sourceMode':st.st_mode&0o777,'targetMode':mode if mode is not None else(st.st_mode&0o755)}
  if target in rows:
   need(all(rows[target].get(k)==item.get(k)for k in('type','bytes','sha256')),'Conflicting artifact target: '+target)
   if mode is not None:rows[target]['targetMode']=mode
  else:rows[target]=item
 def tree(directory,target):
  directory=Path(directory);need(directory.is_dir()and directory.resolve()==directory,'Missing artifact directory: '+str(directory))
  if directory.is_relative_to(a)and 'tests/artifacts/'not in str(directory.relative_to(a)):
   prefix=str(directory.relative_to(a))+'/'
   files=[a/entry['path']for entry in source['files']if entry['path'].startswith(prefix)]
  else:files=sorted(directory.rglob('*'))
  for file in files:
   need(not file.is_symlink(),'Artifact symlink requires explicit mapping')
   if file.is_file():add(file,target+'/'+str(file.relative_to(directory)))
 for item in backend['rows']:
  row=dict(item)
  if row['type']=='file':row['source']=str((a/row['source']).relative_to(root))
  rows[row['target']]=row
 c=a/'tests/artifacts/current-core-api-capsule-r1'
 extension=a/'packages/ingenium-extension/tests/artifacts/current-extension-memory-build-r1'
 # Package the same current Core/API inputs accepted by their original compilers.
 # This binds the existing compiler view to committed source without rebuilding it.
 owned=json.loads((c/'.task-owner.json').read_text());frozen=p/'coordination/integration'
 need(owned['owner']==OWNER and owned['currentCoreCompiledFreeze']=='kubernetes-core-build.json'and owned['currentApiInputFreeze']=='kubernetes-api-input-freeze-r13.json','Current Kubernetes Core/API compiler view required')
 core_build=json.loads((frozen/'kubernetes-core-build.json').read_text())
 api_build=json.loads((frozen/'kubernetes-api-build-r13.json').read_text())
 api_inputs=json.loads((frozen/owned['currentApiInputFreeze']).read_text())
 core_runtime=json.loads((frozen/owned['currentCoreRuntimeFreeze']).read_text())
 need(core_build['complete']and core_build['compilerStatus']==0 and api_build['complete']and api_build['compilerStatus']==0 and api_build['inventorySha256']==api_inputs['apiInventorySha256']and core_runtime['complete'],'Successful current Core/API builds required')
 for entry in core_build['coreInputs']+api_inputs['apiContentInputs']+api_inputs.get('apiRuntimeOverlayInputs',[])+core_runtime['coreRuntimeInputs']:
  need(entry['source']in committed and committed[entry['source']]['sha256']==entry['sha256'],'Compiler input differs from committed source: '+entry['source'])
 for entry in core_build['data']:
  name='packages/ingenium-core/data/'+entry['path'];copied=c/'node_modules/ingenium-core/dist/data'/entry['path']
  need(name in committed and committed[name]['sha256']==entry['sha256']and copied.is_file()and hashlib.sha256(copied.read_bytes()).hexdigest()==entry['sha256'],'Core migration/data bytes differ: '+name)
 for directory,target in [
  (c/'node_modules/ingenium-core/dist','/app/packages/ingenium-core/dist'),
  (c/'services/ingenium-api/dist','/app/services/ingenium-api/dist'),
  (c/'packages/ingenium-email/dist','/app/packages/ingenium-email/dist'),
  (extension/'extension/dist','/app/packages/ingenium-extension/dist'),
  (extension/'server/dist','/app/services/ingenium-server/dist')]:tree(directory,target)
 for package in ['packages/ingenium-core','packages/ingenium-email','packages/ingenium-extension','services/ingenium-api','services/ingenium-server']:
  add(a/package/'package.json','/app/'+package+'/package.json')
 standalone=p/'runtime/current-dashboard-standalone-r1'
 need(1<=args.frontend_build<=100000,'Invalid frontend build receipt')
 front=p/'coordination/integration';number=str(args.frontend_build)
 front_build=json.loads((front/('current-dashboard-build-r'+number+'.json')).read_text())
 front_plan=json.loads((front/('current-dashboard-build-view-plan-r'+number+'.json')).read_text())
 moved=json.loads((front/('dashboard-standalone-move-r'+number+'.json')).read_text());server=moved['relativeAppDir']
 need(front_build['complete']and front_build['status']==0 and front_build['inventorySha256']==front_plan['sourceInventorySha256'],'Completed frontend build required')
 need(all(row['source']in committed and committed[row['source']]['sha256']==row['sha256']for row in front_plan['files']),'Frontend build differs from committed release source')
 need(moved['to']==str(standalone)and moved['owner']==OWNER and hashlib.sha256((standalone/server/'server.js').read_bytes()).hexdigest()==moved['entrySha256'],'Moved frontend identity changed')
 need((standalone/server/'.next/BUILD_ID').read_text().strip()=='veyra-'+front_plan['sourceInventorySha256'],'Frontend build ID changed')
 for file in sorted(standalone.rglob('*')):
  need(not file.is_symlink(),'Unexpected standalone alias')
  if not file.is_file()or file==standalone/'.task-owner.json':continue
  relative=str(file.relative_to(standalone))
  if relative==server or relative.startswith(server+'/'):relative='services/ingenium-dashboard'+relative[len(server):]
  elif '/tests/artifacts/current-dashboard-build-view-r2/'in relative:
   relative=relative.replace('services/ingenium-dashboard/tests/artifacts/current-dashboard-build-view-r2/','')
  add(file,'/app/'+relative)
 for directory in ['docs','.opencode/agents','.opencode/commands','.opencode/skills','config/opencode-managed','nginx']:
  tree(a/directory,'/app/'+directory)
 tree(a/'packages/ingenium-core/data/migrations','/app/packages/ingenium-core/data/migrations')
 # Docker's explicit policy COPY preserves the canonical JSON bytes after tsc.
 need(json.loads((c/'services/ingenium-api/dist/config/dashboard-safe-reads.json').read_text())==json.loads((a/'services/ingenium-api/config/dashboard-safe-reads.json').read_text()),'Compiled API read policy differs from source')
 rows.pop('/app/services/ingenium-api/dist/config/dashboard-safe-reads.json')
 add(a/'services/ingenium-api/config/dashboard-safe-reads.json','/app/services/ingenium-api/dist/config/dashboard-safe-reads.json',0o444)
 plugin=json.loads(command(['node',str(a/'packages/ingenium-extension/scripts/plugin-source-closure.mjs'),'--list'],cwd=a))
 for name in plugin['files']:add(a/'packages/ingenium-extension'/name,'/app/packages/ingenium-extension/'+name)
 for file in(a/'scripts').iterdir():
  if file.suffix in('.sh','.mjs')and file.name not in('start-vscode.sh','validate-vscode-theme-manifest.mjs'):
   add(file,'/app/scripts/'+file.name,0o555 if file.suffix=='.sh'else 0o444)
 for name in['supervisord.conf','control-plane-supervisord.conf','runtime-supervisord.conf']:add(a/name,'/app/'+name,0o444)
 add(a/'scripts/docker-entrypoint.sh','/app/entrypoint.sh',0o555)
 rows['/app/scripts']={'type':'directory','target':'/app/scripts','targetMode':0o555}
 rows['/app/.opencode/agents/execution/ingenium-llm-broker.md']['targetMode']=0o444
 for name in['/app/packages/ingenium-extension/dist/scripts/init-project.js','/app/scripts/normalize-agent-profiles.sh','/app/scripts/run-init-project.sh']:
  need(name in rows,'Required CLI executable missing');rows[name]['targetMode']=0o555
 rows['/app/packages/ingenium-extension/scripts/source-snapshot.mjs']['targetMode']=0o444
 if not app_layer.exists():
  print('Building application layer from current artifacts',flush=True)
  with app_layer.open('xb')as output:app=write_layer(root,list(rows.values()),output,source_date_epoch=epoch,external_symlink_targets=['/app/packages/ingenium-core','/app/packages/ingenium-email','/app/packages/ingenium-extension','/app/services/ingenium-api','/app/services/ingenium-server'],max_compressed_bytes=192*1024**2)
  (p/'runtime/veyra-application-layer.json').write_text(json.dumps({'sourceRevision':revision,'sourceSha256':source['sourceSha256'],'layer':app},indent=2))
 else:
  saved=json.loads((p/'runtime/veyra-application-layer.json').read_text());need(saved['sourceRevision']==revision and saved['sourceSha256']==source['sourceSha256'],'Existing application layer belongs to different source')
  app=saved['layer'];need(digest(app_layer.read_bytes())==app['digest'],'Existing application layer changed')
 reader=RegistryImageReader('jtmb92/ingenium');image=reader.image(PIN)
 account_names=['/etc/'+name for name in['passwd','passwd-','group','group-','shadow','shadow-','gshadow','gshadow-']]
 accounts=metadata_files(reader,image,18,account_names)
 overlay=[]
 def data(name,value,mode=0o444,uid=0,gid=0):overlay.append((name,value if isinstance(value,bytes)else value.encode(),mode,uid,gid,'file'))
 def directory(name,mode=0o755,uid=0,gid=0):overlay.append((name,b'',mode,uid,gid,'directory'))
 def link(name,target):overlay.append((name,target,0o777,0,0,'symlink'))
 for name,value in accounts.items():
  lines=[]
  for line in value.decode().splitlines():
   fields=line.split(':')
   if fields[0]=='ingenium-vscode':continue
   if name.rsplit('/',1)[-1].rstrip('-')in('group','gshadow'):
    for n in range(2,len(fields)):fields[n]=','.join(v for v in fields[n].split(',')if v!='ingenium-vscode')
   lines.append(':'.join(fields))
  data(name,'\n'.join(lines)+'\n',0o640 if 'shadow'in name else 0o644,0,42 if 'shadow'in name else 0)
 data('/home/.wh.ingenium-vscode',b'',0)
 vendor=p/'tmp/veyra-vendor-security'
 if not vendor.exists():command(['/usr/bin/python3','-I','-B',str(a/'scripts/prepare-vendor-security.py'),'--manifest',str(a/'config/vendor-security.json'),'--output',str(vendor)])
 vendor_manifest=json.loads((vendor/'manifest.json').read_text())
 for number,item in enumerate(vendor_manifest['packages']):
  need(item['target']=='/usr/local/lib/node_modules/npm/node_modules/undici','Unexpected vendor overlay')
  directory(item['target'])
  data(item['target']+'/.wh..wh..opq',b'',0)
  package=vendor/str(number)/'package'
  for file in sorted(package.rglob('*')):
   if file.is_dir():directory(item['target']+'/'+str(file.relative_to(package)))
   else:data(item['target']+'/'+str(file.relative_to(package)),file.read_bytes(),file.stat().st_mode&0o755)
 managed='/usr/local/share/ingenium/opencode-managed'
 for file in sorted((a/'config/opencode-managed').rglob('*')):
  if file.is_file():data(managed+'/'+str(file.relative_to(a/'config/opencode-managed')),file.read_bytes())
 for name in['','/agents','/plugins','/plugins/enforce-job-agent','/plugins/enforce-reserved-broker']:directory(managed+name,0o555)
 data(managed+'/agents/ingenium-llm-broker.md',(a/'.opencode/agents/execution/ingenium-llm-broker.md').read_bytes())
 code="import{readFileSync}from'node:fs';const m=await import(process.argv[1]);process.stdout.write(JSON.stringify(m.deriveWorkspaceOpenCodeConfig(JSON.parse(readFileSync(process.argv[2],'utf8'))),null,2))"
 derived=command(['node','--input-type=module','-e',code,(a/'scripts/derive-workspace-opencode-config.mjs').as_uri(),str(a/'config/opencode-managed/opencode.json')],cwd=a)+bytes([10])
 data(managed+'/opencode-workspace.json',derived)
 directory('/etc/opencode',0o555);link('/etc/opencode/opencode.json',managed+'/opencode.json')
 link('/usr/local/bin/ingenium-init-project','/app/scripts/run-init-project.sh')
 config_match=re.search(r"RUN echo '(\{.*\})' > /app/config/opencode.container.json",(a/'Dockerfile').read_text())
 need(config_match,'Canonical compatibility config missing');container_config=config_match.group(1).encode()+b'\n'
 data('/app/config/opencode.container.json',container_config);data('/app/opencode.json',container_config)
 directory('/app/.ingenium',0o770,1101,1201);directory('/app/.ingenium/logs',0o770,1101,1201);directory('/workspace')
 for suffix in['','/client_body','/proxy','/fastcgi','/uwsgi','/scgi']:directory('/run/ingenium-gateway'+suffix,0o700,1104,1104)
 link('/run/ingenium-gateway/runtime-aliases.conf','/app/nginx/runtime-aliases-compatibility.conf')
 for suffix in['/.config','/.config/opencode','/.local','/.local/share','/.local/share/opencode','/.local/share/opencode/log']:directory('/home/ingenium-opencode'+suffix,0o755,1105,1105)
 overlay_body,overlay_descriptor,overlay_diff=tar_bytes(overlay,epoch)
 selected=[{**image['manifest']['layers'][n],'mediaType':'application/vnd.oci.image.layer.v1.tar+gzip'}for n in LAYERS]
 selected.append({k:app[k]for k in('mediaType','digest','size')});selected.append(overlay_descriptor)
 cfg=copy.deepcopy(image['config']);cfg['created']=datetime.datetime.fromtimestamp(epoch,datetime.timezone.utc).isoformat().replace('+00:00','Z')
 cfg['rootfs']={'type':'layers','diff_ids':[image['config']['rootfs']['diff_ids'][n]for n in LAYERS]+[app['diffId'],overlay_diff]}
 cfg['history']=[{'created':cfg['created'],'created_by':'Veyra immutable runtime/application input '+d['digest']}for d in selected]
 cfg['config']['Labels']={**cfg['config'].get('Labels',{}),'org.opencontainers.image.revision':revision,'org.opencontainers.image.source':'https://github.com/jtmb/ingenium','org.ingenium.source.sha256':source['sourceSha256'],'org.veyra.image.role':args.role}
 cfg['config']['Env']=[v for v in cfg['config'].get('Env',[])if not v.startswith(('VSCODE_','CODE_SERVER_','INGENIUM_DEPLOYMENT_MODE='))]
 cfg['config']['User']=''
 if args.role in('compatibility','control-plane'):
  cfg['config']['Env'].append('INGENIUM_DEPLOYMENT_MODE='+args.role);cfg['config']['Entrypoint']=['/app/entrypoint.sh']
 elif args.role=='user-runtime':cfg['config']['User']='appuser';cfg['config']['Entrypoint']=['/app/scripts/runtime-entrypoint.sh']
 else:cfg['config']['Entrypoint']=['/app/scripts/runtime-control-entrypoint.sh',args.role.removeprefix('runtime-')]
 cfg['config'].pop('Cmd',None)
 config_bytes=encode(cfg);config_descriptor={'mediaType':'application/vnd.oci.image.config.v1+json','digest':digest(config_bytes),'size':len(config_bytes)}
 manifest_bytes=encode({'schemaVersion':2,'mediaType':'application/vnd.oci.image.manifest.v1+json','config':config_descriptor,'layers':selected})
 manifest_descriptor={'mediaType':'application/vnd.oci.image.manifest.v1+json','digest':digest(manifest_bytes),'size':len(manifest_bytes),'platform':{'os':'linux','architecture':'amd64'}}
 print('Writing runnable '+args.role+' OCI image',flush=True)
 with tarfile.open(out,mode='w',format=tarfile.USTAR_FORMAT)as archive:
  written=set()
  def member(name,size,stream):
   info=tarfile.TarInfo(name);info.size=size;info.mode=0o444;info.mtime=epoch;archive.addfile(info,stream)
  def body(name,value):member(name,len(value),io.BytesIO(value))
  body('oci-layout',encode({'imageLayoutVersion':'1.0.0'}))
  body('index.json',encode({'schemaVersion':2,'manifests':[manifest_descriptor]}))
  body('blobs/sha256/'+config_descriptor['digest'].split(':')[1],config_bytes)
  body('blobs/sha256/'+manifest_descriptor['digest'].split(':')[1],manifest_bytes)
  for n in LAYERS:
   descriptor=image['manifest']['layers'][n]
   if descriptor['digest']in written:continue
   print('Runtime layer '+str(n),flush=True)
   with reader.blob(descriptor)as stream:
    member('blobs/sha256/'+descriptor['digest'].split(':')[1],descriptor['size'],stream)
    need(stream.read(1)==b'','Runtime layer grew');stream.verify()
   written.add(descriptor['digest'])
  with app_layer.open('rb')as stream:member('blobs/sha256/'+app['digest'].split(':')[1],app['size'],stream)
  body('blobs/sha256/'+overlay_descriptor['digest'].split(':')[1],overlay_body)
 result={'artifact':str(out),'role':args.role,'digest':manifest_descriptor['digest'],'revision':revision,'sourceSha256':source['sourceSha256'],'bytes':out.stat().st_size,'published':False,'deployed':False,'acceptance':'Built runnable candidate; startup/platform/product acceptance remains'}
 (p/'runtime/veyra-linux-image.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result),flush=True)
if __name__=='__main__':main()
