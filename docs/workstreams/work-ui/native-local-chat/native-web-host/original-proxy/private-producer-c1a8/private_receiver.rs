//! Child of service routes::local_workspaces::web_original.
//! A concrete mounted streaming prompt receiver; NOT a native grant factory.
//! Only its broker child module may construct Scope after genuine OS enrollment.
use super::*;
use axum::{body::Body,extract::{Request,State},http::{HeaderValue,StatusCode},response::{IntoResponse,Response},Router};
use std::sync::atomic::AtomicBool;
use std::sync::OnceLock;

// No Deserialize/Default/public constructor. These are actual retained objects,
// never supplied renderer proof. Root's approved broker must retain the same
// native peer/process/window owner in its original registry alongside this Arc.
pub(super) struct Scope{
 state:Arc<ServiceState>,binding:Arc<LocalWorkspaceBinding>,lease:Arc<LocalWebLease>,
 endpoint:OnceLock<Endpoint>,authorization:HeaderValue,
 fenced:AtomicBool,
}
struct Endpoint{host:HeaderValue,origin:HeaderValue}
impl Scope{
 fn current(&self)->Result<(),String>{
  if self.fenced.load(Ordering::Acquire){return Err("Original private Web peer disconnected".into())}
  check(&self.state,&self.binding,&self.lease)
 }
}
fn exact_single(headers:&axum::http::HeaderMap,name:&str,expected:&HeaderValue)->bool{
 let mut all=headers.get_all(name).iter();let Some(actual)=all.next()else{return false};
 if all.next().is_some()||actual.as_bytes().len()!=expected.as_bytes().len(){return false}
 // Fixed scoped secret, no renderer token/query/cookie and no body collection.
 let different=actual.as_bytes().iter().zip(expected.as_bytes()).fold(0u8,|v,(a,b)|v|(a^b));different==0
}
pub(crate) struct PrivateMount{router:Router,scope:Arc<Scope>}
impl PrivateMount{
 pub(crate) fn router_clone(&self)->Router{self.router.clone()}
 pub(crate) fn fence(&self){self.scope.fenced.store(true,Ordering::Release);self.scope.lease.revoke();}
 pub(crate) fn bind_original_endpoint(&self,actual:std::net::SocketAddr)->Result<(),()>{
  if !actual.ip().is_loopback()||actual.port()==0{return Err(())}
  let host=HeaderValue::from_str(&actual.to_string()).map_err(|_|())?;
  let origin=HeaderValue::from_str(&format!("http://{actual}")).map_err(|_|())?;
  self.scope.endpoint.set(Endpoint{host,origin}).map_err(|_|())
 }
}
fn router(scope:Arc<Scope>)->PrivateMount{
 // Dedicated original listener ONLY. Never nest into ordinary bearer routes.
 PrivateMount{router:Router::new().fallback(receive).with_state(scope.clone()),scope}
}
async fn receive(State(scope):State<Arc<Scope>>,request:Request<Body>)->Response{
 match receive_original(scope,request).await{Ok(response)=>response,Err(())=>StatusCode::FORBIDDEN.into_response()}
}
async fn receive_original(scope:Arc<Scope>,request:Request<Body>)->Result<Response,()>{
 scope.current().map_err(|_|())?;
 let endpoint=scope.endpoint.get().ok_or(())?;
 if request.uri().scheme().is_some()||request.uri().authority().is_some()
  ||!exact_single(request.headers(),"host",&endpoint.host)
  ||!exact_single(request.headers(),"authorization",&scope.authorization){return Err(())}
 // Origin is an additional rejection filter; it never authenticates the child.
 if request.headers().contains_key("origin")&&!exact_single(request.headers(),"origin",&endpoint.origin){return Err(())}
 let path=format!("/api/session/{}/prompt",scope.lease.session_id());
 if request.method()!=axum::http::Method::POST||request.uri().path()!=path{
  // Asset/read/SSE/PTY adapters are an explicit remaining constructor gate.
  // No altered HTML, fake upstream response or generic effect proxy fallback.
  return Ok(StatusCode::SERVICE_UNAVAILABLE.into_response())
 }
 let target=request.uri().path_and_query().ok_or(())?.as_str().to_owned();
 if target.len()>16384{return Err(())}
 let mut content=Vec::new();let mut header_bytes=0usize;
 for name in ["content-type","content-encoding","accept"]{
  let mut values=request.headers().get_all(name).iter();let Some(value)=values.next()else{continue};
  if values.next().is_some(){return Err(())}let value=value.to_str().map_err(|_|())?;
  header_bytes=header_bytes.checked_add(name.len()+value.len()).filter(|n|*n<=16384).ok_or(())?;
  content.push((name.to_owned(),value.to_owned()));
 }
 // The source applies a bounded content-header envelope, not a payload/RSS
 // claim. Hyper may already own header/read-ahead buffers before this handler.
 // No Authorization/Cookie/Origin is forwarded as replayable content.
 scope.current().map_err(|_|())?;
 let original=super::scoped_intake::receive_prompt(scope.state.clone(),scope.binding.clone(),scope.lease.clone(),"POST",&target,&content,request.into_body()).await.map_err(|_|())?;
 scope.current().map_err(|_|())?;
 let response=super::submit_prompt(scope.state.clone(),scope.binding.clone(),scope.lease.clone(),original).await.map_err(|_|())?;
 // A genuine private ACK is already constrained to non3xx; keep a final guard.
 if response.status().is_redirection(){return Err(())}Ok(response)
}
