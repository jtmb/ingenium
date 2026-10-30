"""Representation-only source delta. No Native writes/builds/runtime/DDL."""
import difflib,hashlib,json,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parent;REPO=ROOT.parents[6]
BASE='b4b5c353c702a4439fbdaef15a093819594eb22d'
PREFIX='docs/workstreams/work-ui/native-local-chat/native-web-host/original-proxy/engine-retirement-fbf7'
for path in subprocess.check_output(['git','-C',str(REPO),'ls-tree','-r','--name-only',BASE,'--',PREFIX]).decode().splitlines():
 assert (REPO/path).read_bytes()==subprocess.check_output(['git','-C',str(REPO),'show',BASE+':'+path]),('immutable b4 source drift',path)
prior=ROOT.parent/'engine-retirement-fbf7'/'compose.py';env={'__file__':str(prior),'__name__':'source_composition'}
exec(compile(prior.read_text().rsplit('\npatch=[];manifest=[]\n',1)[0],str(prior),'exec'),env)
before=env['after'].copy();after=before.copy();replace=env['replace'];sha=env['sha']
WEB,TRANSPORT,CLOSER=[env[k] for k in ('WEB','TRANSPORT','CLOSER')]
MAT='crates/adapters/src/opencode/desktop_runtime/local_workspaces/web_materialization.rs'
data=after[WEB]
data=replace(data,'    body: Vec<u8>,\n    input_sha256: String,','    body:Arc<[u8]>,\n    input_sha256: String,')
data=replace(data,'method, raw_target: target.into(), route, query, headers: content, body, input_sha256','method, raw_target: target.into(), route, query, headers: content, body:Arc::from(body), input_sha256')
data=replace(data,'    pub fn body(&self) -> &[u8] { &self.body }','    pub fn body(&self) -> &[u8] { &self.body }\n    pub(crate) fn body_owner(&self)->Arc<[u8]>{self.body.clone()}')
data=replace(data,'scope["body_bytes"]=json!(self.body);','scope["body_bytes"]=json!(self.body.as_ref());')
data=replace(data,'        match reserve(original,effective,files).map_err(|_|RuntimeError::Storage)?{','        drop(view); // readonly inspection finished; exact original bytes remain owned\n        match reserve(original,effective,files).map_err(|_|RuntimeError::Storage)?{')
data=replace(data,'        } // Windows forwards original URIs under the actual retained chain.','        } // Windows forwards original URIs under the actual retained chain.\n        drop(body); // policy view ended; do not retain another full inline JSON string')
data=replace(data,'original.raw_target(),original.headers(),effective.bytes())?;','original.raw_target(),original.headers(),effective.bytes_owner())?;');after[WEB]=data
data=after[MAT]
data=replace(data,'use std::{collections::{BTreeMap,BTreeSet},ops::Range};','use std::{collections::{BTreeMap,BTreeSet},ops::Range,sync::Arc};')
data=replace(data,'    bytes:Vec<u8>,','    bytes:Arc<[u8]>,')
data=replace(data,'    pub fn bytes(&self)->&[u8]{&self.bytes}','    pub fn bytes(&self)->&[u8]{&self.bytes}\n    pub(crate) fn bytes_owner(&self)->Arc<[u8]>{self.bytes.clone()}')
data=replace(data,'bytes:effective,transformations','bytes:Arc::from(effective),transformations')
data=replace(data,'bytes:original.body().to_vec(),original_body_sha256','bytes:original.body_owner(),original_body_sha256');after[MAT]=data
data=after[TRANSPORT]
data=replace(data,'content_headers:&[(String,String)],effective_body:&[u8])','content_headers:&[(String,String)],effective_body:Arc<[u8]>)')
data=replace(data,'  let request=request.body(effective_body.to_vec()).build().map_err(|_|EngineError::Transport)?;','''  let length=effective_body.len() as u64;
  // Pinned blocking Body::sized owns this immutable Arc cursor and sends
  // bounded chunks. It creates no full-size request copy or filesystem read.
  let request=request.body(reqwest::blocking::Body::sized(std::io::Cursor::new(effective_body),length)).build().map_err(|_|EngineError::Transport)?;''')
data=replace(data,'&[],b"{}").unwrap();','&[],Arc::from(&b"{}"[..])).unwrap();')
# Drain the fixture request body before returning a deliberately truncated
# response. Unread request bytes could otherwise turn socket close into reset.
data=replace(data,'   loop{let mut line=String::new();reader.read_line(&mut line).unwrap();if line=="\\r\\n"{break;}}','''   let mut length=0;
   loop{let mut line=String::new();reader.read_line(&mut line).unwrap();if line=="\\r\\n"{break;}
    if let Some(value)=line.to_ascii_lowercase().strip_prefix("content-length:"){length=value.trim().parse::<usize>().unwrap();}}
   let mut body=vec![0;length];reader.read_exact(&mut body).unwrap();''')
data+='''
#[cfg(test)]mod shared_body_tests{
 use super::*;
 use std::{io::{BufRead,BufReader,Write},net::TcpListener,thread};
 #[test]fn actual_reader_body_keeps_same_owner_and_exact_wire_bytes(){
  let listener=TcpListener::bind("127.0.0.1:0").unwrap();
  let client=OpenCodeClient::new(&format!("http://{}",listener.local_addr().unwrap()),None,Duration::from_secs(2)).unwrap();
  let expected:Arc<[u8]>=Arc::from(&br#"{ "text":"x", "metadata":{"future":true},"delivery":"queue" }"#[..]);
  let peer_expected=expected.clone();
  let worker=thread::spawn(move||{
   let(mut stream,_)=listener.accept().unwrap();let mut reader=BufReader::new(stream.try_clone().unwrap());let mut length=0;
   loop{let mut line=String::new();reader.read_line(&mut line).unwrap();if line=="\\r\\n"{break;}
    if let Some(value)=line.to_ascii_lowercase().strip_prefix("content-length:"){length=value.trim().parse::<usize>().unwrap();}}
   let mut bytes=vec![0;length];reader.read_exact(&mut bytes).unwrap();assert_eq!(bytes,peer_expected.as_ref());
   stream.write_all(b"HTTP/1.1 200 OK\\r\\nContent-Length: 2\\r\\nConnection: close\\r\\n\\r\\n{}").unwrap();
  });
  let mut request=client.prepare_original_web_prompt("ses_fixture","/api/session/ses_fixture/prompt",&[],expected.clone()).unwrap();
  assert!(Arc::strong_count(&expected)>=2,"prepared actual reader must retain shared original bytes");
  request.execute_retained();worker.join().unwrap();assert_eq!(request.observation.body,b"{}");
  let mut close=RetainedWebTransportClose::retain(request);assert!(close.finish_until(std::time::Instant::now()+Duration::from_secs(3)).unwrap().is_some());
 }
}
''';after[TRANSPORT]=data
data=after[CLOSER];data=replace(data,'&[],b"{}").unwrap();','&[],Arc::from(&b"{}"[..])).unwrap();');after[CLOSER]=data
patch=[];manifest=[]
for path,post in after.items():
 pre=before.get(path,'')
 if pre==post:continue
 patch.extend(difflib.unified_diff(pre.splitlines(True),post.splitlines(True),fromfile='a/'+path,tofile='b/'+path))
 manifest.append({'path':path,'preimage_sha256':sha(pre.encode()),'postimage_sha256':sha(post.encode()),'bytes':len(post.encode())})
raw=''.join(line[1:] if line in (' \n',' \r\n') else line for line in patch).encode()
(ROOT/'shared-request-bytes.patch').write_bytes(raw)
(ROOT/'manifest.json').write_text(json.dumps({'base':BASE,'scope':'representation only; all hashes, quotas, history, auth and bounds unchanged; no activation','patch_sha256':sha(raw),'patch_bytes':len(raw),'files':manifest},indent=2)+'\n')
print(json.dumps({'files':len(manifest),'patch_bytes':len(raw),'sha256':sha(raw)}))
