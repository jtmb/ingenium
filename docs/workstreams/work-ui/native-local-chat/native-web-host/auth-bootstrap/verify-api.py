"""Read actual cached declarations only; no Cargo invocation or runtime objects."""
import hashlib,json,os,re
from pathlib import Path
root=Path(__file__).resolve().parent
cache=Path(r"C:\Users\james\AppData\Local\Packages\OpenAI.Codex_2p2nqsd0c76g0\LocalCache\Local\Veyra-MVP-native\cargo-home\registry\src\index.crates.io-1949cf8c6b5b557f") if os.name=="nt" else Path("/mnt/c/Users/james/AppData/Local/Packages/OpenAI.Codex_2p2nqsd0c76g0/LocalCache/Local/Veyra-MVP-native/cargo-home/registry/src/index.crates.io-1949cf8c6b5b557f")
files={"bindings":cache/"webview2-com-sys-0.39.1/src/bindings.rs","callbacks":cache/"webview2-com-0.39.1/src/callback.rs","macros":cache/"webview2-com-macros-0.8.1/src/lib.rs","windows":cache/"windows-0.62.2/Cargo.toml"}
checks={
 "bindings":[r"impl ICoreWebView2_22",r"pub unsafe fn AddWebResourceRequestedFilterWithRequestSourceKinds",r"pub unsafe fn RemoveWebResourceRequestedFilterWithRequestSourceKinds",r"pub unsafe fn add_WebResourceRequested",r"pub unsafe fn remove_WebResourceRequested\(&self, token: i64\)",r"pub unsafe fn add_BasicAuthenticationRequested",r"pub unsafe fn remove_BasicAuthenticationRequested",r"pub unsafe fn RequestedSourceKind",r"pub unsafe fn SetHeader",r"pub unsafe fn RemoveHeader",r"pub unsafe fn CreateWebResourceResponse",r"pub unsafe fn SetResponse",r"pub unsafe fn SetCancel\(&self, cancel: bool\)",r"COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_ALL"],
 "callbacks":[r"pub struct WebResourceRequestedEventHandler",r"pub struct BasicAuthenticationRequestedEventHandler"],
 "macros":[r"pub fn create",r"-> #interface"],"windows":[r'version = "0\.62\.2"']}
records=[]
for name,path in files.items():
 data=path.read_bytes();text=data.decode("utf-8");matches=[]
 for pattern in checks[name]:
  found=re.search(pattern,text)
  if not found:raise RuntimeError(f"cached declaration missing: {name}: {pattern}")
  matches.append({"declaration":pattern,"line":text[:found.start()].count("\n")+1})
 records.append({"path":str(path),"sha256":hashlib.sha256(data).hexdigest(),"bytes":len(data),"declarations":matches})
source=root/"sources/apps/desktop/src-tauri/src/local_web_auth.rs"
body=source.read_text(encoding="utf-8")
if "SetUserName(" in body or "SetPassword(" in body or "CreateCoreWebView2" in body or "#[tauri::command]" in body:raise RuntimeError("unexpected credential-cache/runtime/command API")
result={"status":"cached API declarations checked; NOT Rust compilation/runtime/auth or redirect qualification","records":records,"auth_source_sha256":hashlib.sha256(source.read_bytes()).hexdigest(),"rust_fixtures":"five supplied, not executed by worker","unsupported_proof":["resource requested args have no redirect-chain flag; navigation IsRedirected is not a subresource credential gate","Basic response credential setters are never used; actual no-browser-auth-cache/runtime proof remains open","all-source filter and source-kind declarations do not establish installed-browser HTTP/SW/WebSocket delivery coverage"],"output_scope":"one existing task root; no upstream/cache source copies"}
(root/"api-evidence.json").write_text(json.dumps(result,indent=2)+"\n",encoding="utf-8")
print(json.dumps({"files":len(records),"declarations":sum(len(item["declarations"]) for item in records),"status":result["status"]}))
