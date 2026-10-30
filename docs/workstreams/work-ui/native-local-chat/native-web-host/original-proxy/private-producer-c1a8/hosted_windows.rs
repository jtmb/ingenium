//! Trusted constructor custody only; no renderer/service grant is minted here.
use std::{collections::HashMap,sync::{Arc,Mutex,atomic::{AtomicBool,Ordering}}};
use tauri::{Manager,Webview,WebviewWindow,Window,WindowEvent};
pub(crate) struct WindowOriginal{uid:uuid::Uuid,root:Webview,parent:Window,fenced:AtomicBool}
impl WindowOriginal{
 pub(crate) fn uid(&self)->uuid::Uuid{self.uid}
 pub(crate) fn parent(&self)->&Window{&self.parent}
 pub(crate) fn check_requester(&self,actual:&Webview)->Result<(),String>{
  // Label is only an expectation here: this object originated at actual Rust
  // construction and holds the real root/parent. Child label cannot match.
  if self.fenced.load(Ordering::Acquire)||actual.label()!=self.root.label()
   ||!crate::ipc_origin::accepts(actual)||!crate::ipc_origin::accepts(&self.root)
   ||!crate::workspace_windows::is_workspace_label(actual.label())
   ||actual.window().label()!=self.parent.label(){return Err("Original native Work window changed".into())}
  if self.root.app_handle().get_webview(self.root.label()).is_none(){return Err("Original Work webview unavailable".into())}
  Ok(())
 }
 pub(crate) fn fence(&self){self.fenced.store(true,Ordering::Release);}
}
#[derive(Default)]pub(crate) struct HostedWindows{originals:Mutex<HashMap<String,Arc<WindowOriginal>>>}
impl HostedWindows{
 /// Call ONLY at actual main/detached Rust construction; not an invoke command.
 /// Loading may still be about:blank; later request admission checks real origin.
 pub(crate) fn retain_created(&self,created:WebviewWindow)->Result<Arc<WindowOriginal>,String>{
  let root:Webview=created.as_ref().clone();
  if !crate::workspace_windows::is_workspace_label(root.label()){return Err("Only actual Work windows may own Web".into())}
  let original=Arc::new(WindowOriginal{uid:uuid::Uuid::new_v4(),parent:root.window(),root,fenced:AtomicBool::new(false)});
  let mut originals=self.originals.lock().map_err(|_|"Original Work window registry unavailable")?;
  if originals.contains_key(original.root.label()){return Err("Previous native Work window original remains retained".into())}
  originals.insert(original.root.label().into(),original.clone());
  let weak=Arc::downgrade(&original);
  created.on_window_event(move|event|if matches!(event,WindowEvent::Destroyed){if let Some(original)=weak.upgrade(){original.fence();}});
  Ok(original)
 }
 pub(crate) fn for_requester(&self,actual:&Webview)->Result<Arc<WindowOriginal>,String>{
  let original=self.originals.lock().map_err(|_|"Original Work window registry unavailable")?.get(actual.label()).cloned().ok_or("Native window was not constructed by this host")?;
  original.check_requester(actual)?;Ok(original)
 }
}
// Native broker's concrete child authority must retain WindowOriginal + actual
// approved peer/control connection + service ChildScopeOriginal. This module
// deliberately has no supplied-boolean/DTO grant constructor or close witness.
