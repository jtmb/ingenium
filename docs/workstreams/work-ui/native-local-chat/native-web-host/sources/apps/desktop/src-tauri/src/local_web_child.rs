//! Proposal only: Root enables tauri/unstable and supplies original authority.
//! Invoke from async commands/off-event-thread; no synchronous Windows creation.
use std::{collections::HashMap, path::Path, sync::{Arc, atomic::{AtomicBool, Ordering}}};
use tauri::{webview::{DownloadEvent, NewWindowFeatures, NewWindowResponse, PermissionKind, PermissionResponse, WebviewBuilder},
    LogicalPosition, LogicalSize, Manager, Rect, Url, Webview, WebviewUrl, Window};

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CssBounds { x:f64, y:f64, width:f64, height:f64, viewport_width:f64, viewport_height:f64 }
pub(crate) fn viewport_bounds(parent:&Window, value:CssBounds)->Result<Rect,String> {
    if ![value.x,value.y,value.width,value.height,value.viewport_width,value.viewport_height].iter().all(|x|x.is_finite())
        || value.x<0.0 || value.y<0.0 || value.width<=0.0 || value.height<=0.0
        || value.viewport_width<=0.0 || value.viewport_height<=0.0 || value.viewport_width>32768.0 || value.viewport_height>32768.0
        || value.x+value.width>value.viewport_width+0.5 || value.y+value.height>value.viewport_height+0.5
    {return Err("Invalid Work viewport bounds".into());}
    let scale=parent.scale_factor().map_err(|_|"Parent scale unavailable")?;
    if !scale.is_finite() || scale<=0.0 {return Err("Parent scale unavailable".into());}
    let size=parent.inner_size().map_err(|_|"Parent size unavailable")?.to_logical::<f64>(scale);
    if !size.width.is_finite() || !size.height.is_finite() || size.width<=0.0 || size.height<=0.0 {return Err("Parent viewport unavailable".into());}
    let sx=size.width/value.viewport_width;let sy=size.height/value.viewport_height;
    Ok(Rect{position:LogicalPosition::new(value.x*sx,value.y*sy).into(),size:LogicalSize::new(value.width*sx,value.height*sy).into()})
}

/// Root's read_local_web_child uses a cloned retained child, outside its map lock.
/// Native observation resolves a lost hide/show acknowledgement without replay.
#[cfg(windows)]
pub(crate) async fn observed_visibility(child:Webview)->Result<bool,String> {
    let(tx,rx)=tokio::sync::oneshot::channel();
    child.with_webview(move|native|{
        let mut visible=windows::Win32::Foundation::BOOL::default();
        let result=unsafe{native.controller().IsVisible(&mut visible)}
            .map(|_|visible.as_bool()).map_err(|_|"Native child visibility unavailable".to_string());
        let _=tx.send(result);
    }).map_err(|_|"Native child observation unavailable")?;
    tokio::time::timeout(std::time::Duration::from_secs(5),rx).await
        .map_err(|_|"Native child visibility timed out")?.map_err(|_|"Native child observation ended")?
}

/// No Deserialize/renderer factory. Root implements this using its original
/// private proxy/engine lease, full LocalWorkspaceOwner+session+engine epoch,
/// actual assets/route-closure qualification and native auth bootstrap.
pub(crate) trait OriginalWebAuthority: Send + Sync + 'static {
    fn binding_id(&self) -> &str;
    fn entry_url(&self) -> &Url; // dedicated PUBLIC proxy origin, native-only
    fn profile(&self) -> &Path; // existing owner profile, never scratch or deleted
    fn check_current(&self) -> Result<(), String>;
    fn revoked(&self) -> bool; // cheap atomic callback, never blocking network
    fn authorize_child(&self, child: &Webview) -> Result<(), String>; // exact-origin native bootstrap; no eval/script/token URL or port-ambient cookie
    fn download(&self, child: Webview, event: DownloadEvent<'_>) -> bool;
    fn permission(&self, child: Webview, kind: PermissionKind) -> PermissionResponse;
    fn new_window(&self, url:Url, features:NewWindowFeatures) -> NewWindowResponse<tauri::Wry>;
    fn release_proxy(&self) -> Result<(), String>; // after positive child close only
}

struct Entry { child: Webview, parent_label:String, authority: Arc<dyn OriginalWebAuthority>, cleanup_required: bool, close_attempted: bool, closed: bool }
struct UnconfirmedCreation { label:String, parent_label:String, _authority:Arc<dyn OriginalWebAuthority> }
pub(crate) struct LocalWebChildren { entries: HashMap<String, Entry>, unconfirmed:HashMap<String,UnconfirmedCreation> }
impl Default for LocalWebChildren { fn default() -> Self { Self { entries: HashMap::new(), unconfirmed:HashMap::new() } } }

impl LocalWebChildren {
    /// Root command checks the requesting Webview label AND trusted app origin;
    /// a child shares its parent's Window and must never pass that guard.
    pub(crate) fn create(&mut self, parent: &Window, authority: Arc<dyn OriginalWebAuthority>, bounds: Rect) -> Result<(), String> {
        authority.check_current()?;
        let id = authority.binding_id().to_owned();
        if self.entries.contains_key(&id) { return Err("This Web binding already has a retained child; read it first.".into()); }
        if self.entries.values().any(|entry|entry.parent_label==parent.label()) {return Err("The retained Work Web child must be closed before replacing its binding.".into());}
        if self.unconfirmed.values().any(|entry|entry.parent_label==parent.label()) {return Err("An original child creation still requires native reconciliation.".into());}
        let target = authority.entry_url().clone();
        let loopback = target.host_str().is_some_and(|host| host == "localhost" || host.parse::<std::net::IpAddr>().is_ok_and(|ip| ip.is_loopback()));
        if !loopback || target.scheme() != "http" || !target.username().is_empty() || target.password().is_some()
            || target.query().is_some() || target.fragment().is_some() || !target.path().starts_with("/server/")
        { return Err("Original dedicated proxy navigation is unavailable.".into()); }
        let origin = target.origin();
        let starting = Arc::new(AtomicBool::new(true));
        let initial = starting.clone();
        let navigation_authority = authority.clone();
        let downloads = authority.clone();
        let permissions = authority.clone();
        let new_windows = authority.clone();
        let label = format!("opencode-child-{}", uuid::Uuid::new_v4());
        let builder = WebviewBuilder::new(&label, WebviewUrl::External(Url::parse("about:blank").map_err(|_| "Invalid bootstrap URL")?))
            .data_directory(authority.profile().to_path_buf()).focused(false).devtools(false)
            .browser_extensions_enabled(false).general_autofill_enabled(false).disable_drag_drop_handler()
            .on_navigation(move |url| !navigation_authority.revoked() &&
                ((initial.load(Ordering::Acquire) && url.as_str() == "about:blank") || url.origin() == origin))
            .on_new_window(move |url, features| if new_windows.revoked() {NewWindowResponse::Deny} else {new_windows.new_window(url,features)})
            .on_download(move |child, event| !downloads.revoked() && downloads.download(child, event))
            .on_permission_request(move |child, kind| if permissions.revoked() { PermissionResponse::Deny } else { permissions.permission(child, kind) });
        // Zero bounds prevents initial content flashing over the trusted UI.
        let child = match parent.add_child(builder, LogicalPosition::new(0.0, 0.0), LogicalSize::new(0.0, 0.0)) {
            Ok(child)=>child,
            Err(_)=>{
                if let Some(child)=parent.app_handle().get_webview(&label) {
                    self.entries.insert(id.clone(),Entry{child,parent_label:parent.label().into(),authority,cleanup_required:true,close_attempted:false,closed:false});
                    return match self.release(&id) {Ok(())=>Err("Child creation failed and its retained handle was closed.".into()),Err(error)=>Err(format!("Child creation failed; cleanup pending for {id}: {error}"))};
                }
                // Absence from the map alone does not prove a partially-created
                // native object retired. Root's original creator must reconcile.
                self.unconfirmed.insert(id.clone(),UnconfirmedCreation{label:label.clone(),parent_label:parent.label().into(),_authority:authority});
                return Err(format!("Child creation unconfirmed; retain original binding {id} and label {label} for native reconciliation."));
            }
        };
        // Enroll before the first fallible post-create step; never lose a handle.
        self.entries.insert(id.clone(), Entry { child, parent_label:parent.label().into(), authority, cleanup_required: false, close_attempted: false, closed: false });
        let entry = self.entries.get(&id).ok_or("Web child enrollment failed")?;
        let initialized = (|| {
            entry.child.hide().map_err(|_| "Could not hide bootstrap child")?;
            entry.authority.authorize_child(&entry.child)?;
            entry.authority.check_current()?;
            starting.store(false, Ordering::Release);
            entry.child.navigate(target).map_err(|_| "Could not navigate the original Web child")?;
            entry.child.set_bounds(bounds).map_err(|_| "Could not position the Web child")?;
            entry.authority.check_current()
        })();
        if let Err(error) = initialized {
            if let Some(entry) = self.entries.get_mut(&id) { entry.cleanup_required = true; }
            return match self.release(&id) {
                Ok(()) => Err(error),
                Err(cleanup) => Err(format!("{error}; cleanup pending for {id}: {cleanup}")),
            };
        }
        Ok(())
    }
    pub(crate) fn show(&mut self, id: &str, bounds: Rect) -> Result<(), String> {
        let entry = self.entries.get_mut(id).ok_or("Web child is unavailable")?;
        if entry.cleanup_required { return Err("Web child cleanup still needs reconciliation".into()); }
        entry.authority.check_current()?;
        entry.child.set_bounds(bounds).map_err(|_| "Web child bounds were not confirmed")?;
        entry.child.show().map_err(|_| "Web child visibility was not confirmed")?;
        if entry.child.window().is_focused().unwrap_or(false) {
            entry.child.set_focus().map_err(|_| "Web child focus was not confirmed")?;
        }
        if let Err(error) = entry.authority.check_current() {
            entry.cleanup_required = true;
            return match entry.child.hide() {
                Ok(()) => Err(error),
                Err(_) => Err(format!("{error}; revoked child hide failed; cleanup required for {id}")),
            };
        }
        Ok(())
    }
    pub(crate) fn hide(&self, id: &str) -> Result<(), String> {
        // Hiding/closing remains allowed after revocation; showing does not.
        self.entries.get(id).ok_or("Web child is unavailable")?.child.hide().map_err(|_| "Web child hide was not confirmed".into())
    }
    pub(crate) fn bounds(&self, id: &str, bounds: Rect) -> Result<(), String> {
        let entry = self.entries.get(id).ok_or("Web child is unavailable")?;
        entry.authority.check_current()?;
        entry.child.set_bounds(bounds).map_err(|_| "Web child bounds were not confirmed")?;
        entry.authority.check_current()
    }
    pub(crate) fn release(&mut self, id: &str) -> Result<(), String> {
        let entry = self.entries.get_mut(id).ok_or("Web child is unavailable")?;
        entry.cleanup_required = true;
        if !entry.closed {
            if entry.child.app_handle().get_webview(entry.child.label()).is_none() { entry.closed=true; }
            else if !entry.close_attempted {
                entry.close_attempted = true;
                entry.child.close().map_err(|_| "Web child close failed; retained for reconciliation")?;
            }
            if entry.child.app_handle().get_webview(entry.child.label()).is_some() {
                return Err("Web child removal is not yet observed; retained for reconciliation without repeating close".into());
            }
            entry.closed = true;
        }
        entry.authority.release_proxy()?;
        self.entries.remove(id);
        Ok(()) // profile/drafts are original user state and are never deleted here
    }
    pub(crate) fn cleanup_pending(&self) -> Vec<String> {
        self.entries.iter().filter(|(_, entry)| entry.cleanup_required).map(|(id, _)| id.clone())
            .chain(self.unconfirmed.iter().map(|(id,entry)|format!("{id}:{}",entry.label))).collect()
    }
    pub(crate) fn hide_revoked(&mut self) -> Vec<String> {
        let mut failed=Vec::new();
        for (id,entry) in &mut self.entries {
            if entry.authority.revoked() {
                entry.cleanup_required=true;
                if entry.child.hide().is_err() {failed.push(id.clone());}
            }
        }
        failed // Root must report and reconcile these exact retained handles
    }
}
