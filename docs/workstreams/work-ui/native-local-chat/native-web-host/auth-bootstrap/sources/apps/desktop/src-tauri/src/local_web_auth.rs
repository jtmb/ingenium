//! Native-only proposal. No command, browser/process creation or proxy factory.
//! Call install/detach off the WebView UI thread. Root retains Attempt on Unknown.
use std::{cell::RefCell, collections::HashMap, sync::{Arc, atomic::{AtomicBool,AtomicUsize,Ordering}}, time::Duration};
use tauri::{Url,Webview};
use webview2_com::{BasicAuthenticationRequestedEventHandler,CoTaskMemPWSTR,WebResourceRequestedEventHandler};
use webview2_com::Microsoft::Web::WebView2::Win32::*;
use windows::{core::{Error,HRESULT,HSTRING,IUnknown,Interface,PWSTR,Result as WinResult,w},Win32::System::Com::IStream};

#[derive(Clone,Copy)]
pub(crate) enum Fault { CallbackDenied, InstallUnknown, CleanupUnknown }
/// Root's real private proxy lease; no Deserialize/Debug/renderer constructor.
/// All methods are cheap, nonblocking and non-reentrant on the UI callback.
pub(crate) trait NativeAuthLease:Send+Sync+'static {
    fn child_label(&self)->&str;
    fn proxy_origin(&self)->&Url;
    fn current(&self)->bool;
    /// Actual original producer rejects every upstream/browser-visible 3xx.
    fn no_redirect_proxy_current(&self)->bool;
    /// Supplies proxy Basic header only, never original engine credentials.
    fn with_proxy_authorization(&self,write:&mut dyn FnMut(&HSTRING)->WinResult<()>)->WinResult<()>;
    fn fault(&self,code:Fault); // queue a static-code fault, never URI/header/log data
}
#[derive(Clone,Copy,PartialEq,Eq)]
pub(crate) enum Phase { Attached,NotAttached,RetainedUnknown }
pub(crate) struct Receipt { pub attempt_id:String,pub phase:Phase }
#[derive(Clone,Copy,PartialEq,Eq)]
enum Token { None,Adding,Known(i64),Removing(i64),Removed,Unknown(i64) }
impl Token {
    fn finish_add(&mut self,value:i64,ack:bool){*self=if ack{Self::Known(value)}else{Self::Unknown(value)};}
    fn remove(&mut self,call:impl FnOnce(i64)->bool)->bool {
        match *self {
            Self::None|Self::Removed=>true,
            Self::Known(token)=>{*self=Self::Removing(token);*self=if call(token){Self::Removed}else{Self::Unknown(token)};matches!(self,Self::Removed)},
            _=>false, // never guess or repeat an unknown removal
        }
    }
    fn gone(&self)->bool{matches!(self,Self::None|Self::Removed)}
}
#[derive(Clone,Copy,PartialEq,Eq)]
enum Filter { None,Adding,Added,Removing,Removed,Unknown }
struct Flags { enabled:AtomicBool,cancelled:AtomicBool,started:AtomicBool,finished:AtomicBool,enrolled:AtomicBool,foreign_registration:AtomicBool,detached:AtomicBool,active:AtomicUsize }
impl Default for Flags {fn default()->Self{Self{enabled:AtomicBool::new(false),cancelled:AtomicBool::new(false),started:AtomicBool::new(false),finished:AtomicBool::new(false),enrolled:AtomicBool::new(false),foreign_registration:AtomicBool::new(false),detached:AtomicBool::new(false),active:AtomicUsize::new(0)}}}
struct Flight(Arc<Flags>);
impl Flight {fn enter(flags:&Arc<Flags>)->Self{flags.active.fetch_add(1,Ordering::AcqRel);Self(flags.clone())}}
impl Drop for Flight {fn drop(&mut self){self.0.active.fetch_sub(1,Ordering::AcqRel);}}
struct Registration {
    child_label:String,core:ICoreWebView2,modern:ICoreWebView2_22,basic:ICoreWebView2_10,
    _resource_handler:ICoreWebView2WebResourceRequestedEventHandler,_basic_handler:ICoreWebView2BasicAuthenticationRequestedEventHandler,
    resource:Token,basic_token:Token,filter:Filter,flags:Arc<Flags>,_lease:Arc<dyn NativeAuthLease>,
}
thread_local!{static REGISTRY:RefCell<HashMap<String,Registration>>=RefCell::new(HashMap::new());}
fn denied()->Error{Error::from_hresult(HRESULT(0x80070005_u32 as i32))}
fn exact_origin(expected:&Url,raw:&str)->bool{
    if raw.len()>32768{return false;}
    Url::parse(raw).is_ok_and(|url|matches!(url.scheme(),"http"|"https")&&url.username().is_empty()&&url.password().is_none()&&url.fragment().is_none()&&url.origin()==expected.origin())
}
fn block(args:&ICoreWebView2WebResourceRequestedEventArgs,env:&ICoreWebView2Environment)->WinResult<()>{unsafe{
    let response=env.CreateWebResourceResponse(None::<&IStream>,403,w!("Forbidden"),w!("Cache-Control: no-store\r\nContent-Length: 0\r\n"))?;
    args.SetResponse(&response)
}}
fn strip(headers:&ICoreWebView2HttpRequestHeaders)->WinResult<()>{unsafe{
    headers.RemoveHeader(w!("Authorization"))?;headers.RemoveHeader(w!("Proxy-Authorization"))
}}
fn sender_matches(sender:Option<ICoreWebView2>,original:&IUnknown)->bool{
    sender.and_then(|value|value.cast::<IUnknown>().ok()).is_some_and(|value|value.as_raw()==original.as_raw())
}
fn resource_callback(sender:Option<ICoreWebView2>,args:Option<ICoreWebView2WebResourceRequestedEventArgs>,original:&IUnknown,env:&ICoreWebView2Environment,lease:&Arc<dyn NativeAuthLease>,flags:&Arc<Flags>)->WinResult<()>{
    let _flight=Flight::enter(flags);
    let Some(args)=args else{flags.enabled.store(false,Ordering::Release);lease.fault(Fault::CallbackDenied);return Err(denied());};
    let retained_headers=RefCell::new(None::<ICoreWebView2HttpRequestHeaders>);
    let run=(||->WinResult<()>{unsafe{
        let request=args.Request()?;let headers=request.Headers()?;
        *retained_headers.borrow_mut()=Some(headers.clone());
        strip(&headers)?; // before every check, including foreign/cancelled requests
        let mut raw=PWSTR::null();request.Uri(&mut raw)?;
        let uri=CoTaskMemPWSTR::from(raw).to_string();
        if !sender_matches(sender,original)||!flags.enabled.load(Ordering::Acquire)||flags.cancelled.load(Ordering::Acquire)
            ||!lease.current()||!lease.no_redirect_proxy_current()||!exact_origin(lease.proxy_origin(),&uri)
        {return block(&args,env);}
        // Require modern source classification too: no legacy worker fallback.
        let args2:ICoreWebView2WebResourceRequestedEventArgs2=args.cast()?;
        let mut source=COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_ALL;args2.RequestedSourceKind(&mut source)?;
        if source.0<=0||source.0&!7!=0{return block(&args,env);}
        let mut written=false;
        lease.with_proxy_authorization(&mut |value|{
            let units=value.as_wide();
            if written||!flags.enabled.load(Ordering::Acquire)||flags.cancelled.load(Ordering::Acquire)||!lease.current()||!lease.no_redirect_proxy_current()
                ||units.len()<=6||units.len()>16384||!units.starts_with(&[66,97,115,105,99,32])||units.iter().any(|c|matches!(*c,0|10|13))
            {return Err(denied());}
            headers.SetHeader(w!("Authorization"),value)?;written=true;Ok(())
        })?;
        if !written||!lease.current()||!flags.enabled.load(Ordering::Acquire)||flags.cancelled.load(Ordering::Acquire){strip(&headers)?;return block(&args,env);}
        Ok(())
    }})();
    if run.is_err(){
        flags.enabled.store(false,Ordering::Release);
        if let Some(headers)=retained_headers.borrow().as_ref(){let _=strip(headers);}
        lease.fault(Fault::CallbackDenied);let _=block(&args,env);return Err(denied());
    }
    Ok(())
}

/// Root stores this native attempt before invoking install. No Drop cleanup:
/// losing a handle/timeout is not proof that callback registration disappeared.
pub(crate) struct Attempt { id:String,child:Webview,lease:Arc<dyn NativeAuthLease>,flags:Arc<Flags> }
impl Attempt {
    pub(crate) fn new(id:String,child:Webview,lease:Arc<dyn NativeAuthLease>)->Result<Self,String>{
        if !uuid::Uuid::parse_str(&id).is_ok_and(|value|!value.is_nil()&&value.to_string()==id)||child.label()!=lease.child_label(){return Err("Invalid original native auth attempt".into());}
        let url=lease.proxy_origin();
        if !matches!(url.scheme(),"http"|"https")||url.host_str().is_none()||url.path()!="/"||!url.username().is_empty()||url.password().is_some()||url.query().is_some()||url.fragment().is_some(){return Err("Original proxy origin unavailable".into());}
        Ok(Self{id,child,lease,flags:Arc::new(Flags::default())})
    }
    fn receipt(&self,phase:Phase)->Receipt{Receipt{attempt_id:self.id.clone(),phase}}
    pub(crate) fn install(&self)->Receipt{
        if self.flags.started.swap(true,Ordering::AcqRel){return self.inspect();}
        let(id,label,lease,flags)=(self.id.clone(),self.child.label().to_owned(),self.lease.clone(),self.flags.clone());
        let(tx,rx)=std::sync::mpsc::sync_channel(1);
        let posted=self.child.with_webview(move|native|{
            let result=(||->WinResult<Phase>{unsafe{
                if flags.cancelled.load(Ordering::Acquire)||!lease.current()||!lease.no_redirect_proxy_current(){return Ok(Phase::NotAttached);}
                let core=native.controller().CoreWebView2()?;
                let modern:ICoreWebView2_22=core.cast()?;let basic:ICoreWebView2_10=core.cast()?;
                let env=core.cast::<ICoreWebView2_2>()?.Environment()?;let identity: IUnknown=core.cast()?;
                let callback_lease=lease.clone();let callback_flags=flags.clone();
                let handler=WebResourceRequestedEventHandler::create(Box::new(move|sender,args|resource_callback(sender,args,&identity,&env,&callback_lease,&callback_flags)));
                let cancel_flags=flags.clone();let cancel_lease=lease.clone();
                let cancel=BasicAuthenticationRequestedEventHandler::create(Box::new(move|_,args|{
                    let _flight=Flight::enter(&cancel_flags);
                    let result=args.ok_or_else(denied).and_then(|args|args.SetCancel(true));
                    if result.is_err(){cancel_flags.enabled.store(false,Ordering::Release);cancel_lease.fault(Fault::CallbackDenied);return Err(denied());}Ok(())
                }));
                REGISTRY.with(|records|->WinResult<Phase>{
                    let mut records=records.borrow_mut();
                    if records.contains_key(&id)||records.values().any(|value|value.child_label==label){flags.foreign_registration.store(true,Ordering::Release);return Err(denied());}
                    flags.enrolled.store(true,Ordering::Release);
                    records.insert(id.clone(),Registration{child_label:label,core,modern,basic,_resource_handler:handler,_basic_handler:cancel,resource:Token::None,basic_token:Token::None,filter:Filter::None,flags:flags.clone(),_lease:lease.clone()});
                    let value=records.get_mut(&id).ok_or_else(denied)?;
                    let mut token=0_i64;value.basic_token=Token::Adding;
                    let result=value.basic.add_BasicAuthenticationRequested(&value._basic_handler,&mut token);
                    value.basic_token.finish_add(token,result.is_ok());result?;
                    token=0;value.resource=Token::Adding;
                    let result=value.core.add_WebResourceRequested(&value._resource_handler,&mut token);
                    value.resource.finish_add(token,result.is_ok());result?;
                    value.filter=Filter::Adding;
                    let result=value.modern.AddWebResourceRequestedFilterWithRequestSourceKinds(w!("*"),COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL,COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_ALL);
                    value.filter=if result.is_ok(){Filter::Added}else{Filter::Unknown};result?;
                    if flags.cancelled.load(Ordering::Acquire)||!lease.current()||!lease.no_redirect_proxy_current(){return Ok(Phase::RetainedUnknown);}
                    flags.enabled.store(true,Ordering::Release);Ok(Phase::Attached)
                })
            }})();
            flags.finished.store(true,Ordering::Release);
            let phase=result.unwrap_or_else(|_|if flags.enrolled.load(Ordering::Acquire)||flags.foreign_registration.load(Ordering::Acquire){Phase::RetainedUnknown}else{Phase::NotAttached});
            if tx.send(phase).is_err(){flags.cancelled.store(true,Ordering::Release);flags.enabled.store(false,Ordering::Release);lease.fault(Fault::InstallUnknown);}
        });
        if posted.is_err(){self.flags.cancelled.store(true,Ordering::Release);self.flags.enabled.store(false,Ordering::Release);self.lease.fault(Fault::InstallUnknown);return self.receipt(Phase::RetainedUnknown);}
        match rx.recv_timeout(Duration::from_secs(5)){
            Ok(phase)=>self.receipt(phase),
            Err(_)=>{self.flags.cancelled.store(true,Ordering::Release);self.flags.enabled.store(false,Ordering::Release);self.lease.fault(Fault::InstallUnknown);self.receipt(Phase::RetainedUnknown)}
        }
    }
    pub(crate) fn inspect(&self)->Receipt{
        if self.flags.detached.load(Ordering::Acquire)||self.flags.finished.load(Ordering::Acquire)&&!self.flags.enrolled.load(Ordering::Acquire)&&!self.flags.foreign_registration.load(Ordering::Acquire){return self.receipt(Phase::NotAttached);}
        if self.flags.finished.load(Ordering::Acquire)&&self.flags.enabled.load(Ordering::Acquire)&&!self.flags.cancelled.load(Ordering::Acquire)&&self.lease.current()&&self.lease.no_redirect_proxy_current(){self.receipt(Phase::Attached)}else{self.receipt(Phase::RetainedUnknown)}
    }
    pub(crate) fn detach(&self)->Receipt{
        self.flags.cancelled.store(true,Ordering::Release);self.flags.enabled.store(false,Ordering::Release);
        if !self.flags.started.load(Ordering::Acquire){self.flags.detached.store(true,Ordering::Release);return self.receipt(Phase::NotAttached);}
        if self.flags.detached.load(Ordering::Acquire){return self.receipt(Phase::NotAttached);}
        let(id,label,flags)=(self.id.clone(),self.child.label().to_owned(),self.flags.clone());
        let(tx,rx)=std::sync::mpsc::sync_channel(1);
        let posted=self.child.with_webview(move|_|{
            let removed=REGISTRY.with(|records|{
                let mut records=records.borrow_mut();
                let Some(value)=records.get_mut(&id)else{return flags.finished.load(Ordering::Acquire)&&!flags.enrolled.load(Ordering::Acquire)&&!flags.foreign_registration.load(Ordering::Acquire);};
                if value.child_label!=label||value.flags.active.load(Ordering::Acquire)!=0{return false;}
                let core=value.core.clone();let basic=value.basic.clone();
                let resource=value.resource.remove(|token|unsafe{core.remove_WebResourceRequested(token).is_ok()});
                let basic_done=value.basic_token.remove(|token|unsafe{basic.remove_BasicAuthenticationRequested(token).is_ok()});
                if resource&&basic_done&&matches!(value.filter,Filter::Added){
                    value.filter=Filter::Removing;
                    value.filter=if unsafe{value.modern.RemoveWebResourceRequestedFilterWithRequestSourceKinds(w!("*"),COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL,COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_ALL)}.is_ok(){Filter::Removed}else{Filter::Unknown};
                }
                if value.resource.gone()&&value.basic_token.gone()&&matches!(value.filter,Filter::None|Filter::Removed){records.remove(&id);true}else{false}
            });
            if removed{flags.detached.store(true,Ordering::Release);}let _=tx.send(removed);
        });
        if posted.is_ok()&&rx.recv_timeout(Duration::from_secs(5)).is_ok_and(|value|value){self.receipt(Phase::NotAttached)}else{self.lease.fault(Fault::CleanupUnknown);self.receipt(Phase::RetainedUnknown)}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]fn exact_origin_rejects_port_scheme_userinfo_and_host_substitution(){
        let expected=Url::parse("http://127.0.0.1:48123/").unwrap();
        assert!(exact_origin(&expected,"http://127.0.0.1:48123/api/session?cursor=opaque"));
        for uri in ["http://127.0.0.1:48124/api/session","https://127.0.0.1:48123/api/session","http://localhost:48123/api/session","http://user:password@127.0.0.1:48123/","http://127.0.0.1.example:48123/","http://127.0.0.1:48123/#fragment"]{assert!(!exact_origin(&expected,uri));}
    }
    #[test]fn failed_add_keeps_observed_token_but_never_guesses_ownership(){let mut slot=Token::Adding;slot.finish_add(77,false);let mut calls=0;assert!(!slot.remove(|_|{calls+=1;true}));assert_eq!(calls,0);assert!(!slot.gone());}
    #[test]fn successful_cleanup_removes_exact_token_once(){let mut slot=Token::Known(91);let mut seen=Vec::new();assert!(slot.remove(|token|{seen.push(token);true}));assert!(slot.remove(|token|{seen.push(token);true}));assert_eq!(seen,vec![91]);}
    #[test]fn unknown_removal_is_retained_without_a_second_native_effect(){let mut slot=Token::Known(19);let mut calls=0;assert!(!slot.remove(|_|{calls+=1;false}));assert!(!slot.remove(|_|{calls+=1;true}));assert_eq!(calls,1);assert!(!slot.gone());}
    #[test]fn one_unknown_slot_does_not_exempt_other_owned_callbacks_from_cleanup(){let mut resource=Token::Unknown(7);let mut basic=Token::Known(11);assert!(!resource.remove(|_|panic!("unknown ownership")));let mut observed=None;assert!(basic.remove(|token|{observed=Some(token);true}));assert_eq!(observed,Some(11));assert!(!resource.gone());}
}
