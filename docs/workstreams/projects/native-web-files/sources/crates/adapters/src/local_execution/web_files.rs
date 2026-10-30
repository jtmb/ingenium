//! Actual byte capture from the existing binding, never a path-as-permission.
use super::*;
use base64::{Engine as _,engine::general_purpose::STANDARD};
use sha2::{Digest,Sha256};
pub(crate) struct CapturedWebFile{pub(crate) bytes:Vec<u8>,pub(crate) identity:Value}
impl LocalWorkspaceBinding{
 pub(crate) fn capture_web_file(&self,parts:&[String],limit:usize,current:&dyn Fn()->Result<(),String>)->Result<CapturedWebFile,String>{
  if parts.is_empty()||parts.len()>128||limit>crate::attachments::MAX_BATCH_BYTES||parts.iter().any(|p|p.is_empty()||p=="."||p==".."||p.len()>255||p.chars().any(|c|c.is_control()||matches!(c,'/'|'\\'))){return Err("web file components unavailable".into());}
  current()?;self.verify()?;
  let captured=match &self.owner.environment{
   LocalEnvironment::Windows=>{
    #[cfg(windows)] {windows_capture(self,parts,limit,current)?}
    #[cfg(not(windows))] {return Err("Windows capture requires actual Windows custody".into());}
   },
   LocalEnvironment::Wsl{..}=>{
    let input=json!({"action":"web_file_read","parts":parts,"limit":limit,
     "installation_id":self.owner.installation_id,"workspace_id":self.owner.workspace_id,
     "expected":serde_json::from_str::<Value>(&self.physical).map_err(|_|"invalid WSL proof")?});
    // Existing bounded transport checks this guard before spawn AND before
    // releasing stdin. Never replace it with root-only/positive DTO authority.
    let reply=crate::wsl_workspace::local_private_request(&self.owner.environment,input,
     &||current().is_ok()&&self.installation.verify().is_ok()).map_err(|_|"original WSL file capture unavailable")?;
    current()?;
    let bytes=STANDARD.decode(reply["bytes_base64"].as_str().ok_or("WSL capture bytes missing")?).map_err(|_|"WSL capture bytes invalid")?;
    if reply["kind"]!="same-environment-web-file-capture-v1"||reply["parts"]!=json!(parts)||bytes.len()>limit
     ||reply["size"].as_u64()!=Some(bytes.len() as u64)||reply["sha256"].as_str()!=Some(format!("{:x}",Sha256::digest(&bytes)).as_str())
     ||reply["bytes_base64"].as_str()!=Some(STANDARD.encode(&bytes).as_str())||!reply["identity"].is_object(){return Err("WSL capture mismatch".into());}
    CapturedWebFile{bytes,identity:reply["identity"].clone()}
   },
  };
  self.verify()?;current()?;Ok(captured)
 }
}
#[cfg(windows)]
fn windows_capture(binding:&LocalWorkspaceBinding,parts:&[String],limit:usize,current:&dyn Fn()->Result<(),String>)->Result<CapturedWebFile,String>{
 use std::{fs::{File,OpenOptions},io::Read,os::windows::{fs::OpenOptionsExt,io::AsRawHandle},path::PathBuf};
 use windows_sys::Win32::Storage::FileSystem::*;
 use windows_sys::Win32::Foundation::GetHandleInformation;
 fn observe(file:&File,directory:bool)->Result<(u64,[u8;16],u64,i64),String>{
  let handle=file.as_raw_handle().cast();
  let mut id:FILE_ID_INFO=unsafe{std::mem::zeroed()};
  let mut standard:FILE_STANDARD_INFO=unsafe{std::mem::zeroed()};
  let mut attributes:FILE_ATTRIBUTE_TAG_INFO=unsafe{std::mem::zeroed()};
  let mut basic:FILE_BASIC_INFO=unsafe{std::mem::zeroed()};let mut flags=0u32;
  if unsafe{GetFileType(handle)}!=FILE_TYPE_DISK
   ||unsafe{GetFileInformationByHandleEx(handle,FileIdInfo,(&mut id as *mut FILE_ID_INFO).cast(),std::mem::size_of_val(&id) as u32)}==0
   ||unsafe{GetFileInformationByHandleEx(handle,FileStandardInfo,(&mut standard as *mut FILE_STANDARD_INFO).cast(),std::mem::size_of_val(&standard) as u32)}==0
   ||unsafe{GetFileInformationByHandleEx(handle,FileAttributeTagInfo,(&mut attributes as *mut FILE_ATTRIBUTE_TAG_INFO).cast(),std::mem::size_of_val(&attributes) as u32)}==0
   ||unsafe{GetFileInformationByHandleEx(handle,FileBasicInfo,(&mut basic as *mut FILE_BASIC_INFO).cast(),std::mem::size_of_val(&basic) as u32)}==0
   ||unsafe{GetHandleInformation(handle,&mut flags)}==0||flags&1!=0
   ||attributes.FileAttributes&FILE_ATTRIBUTE_REPARSE_POINT!=0||attributes.ReparseTag!=0
   ||(standard.Directory!=0)!=directory||standard.DeletePending!=0||id.VolumeSerialNumber==0||id.FileId.Identifier==[0;16]
   ||(!directory&&standard.NumberOfLinks!=1)||standard.EndOfFile<0{return Err("Windows web file handle refused".into());}
  Ok((id.VolumeSerialNumber,id.FileId.Identifier,standard.EndOfFile as u64,basic.LastWriteTime))
 }
 let expected:(u64,[u8;16])=serde_json::from_str(&binding.physical).map_err(|_|"original Windows root identity unavailable")?;
 // Original PrivateRootCustody retains the complete root/ancestor chain without
 // delete sharing. Each opened descendant remains held until this read ends.
 binding.verify()?;
 let mut path=PathBuf::from(binding.directory());let mut held=Vec::new();
 for index in 0..=parts.len(){
  current()?;
  if index>0{path.push(&parts[index-1]);}
  let directory=index<parts.len();
  let mut options=OpenOptions::new();options.read(true).share_mode(FILE_SHARE_READ)
   .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT|if directory{FILE_FLAG_BACKUP_SEMANTICS}else{0});
  let file=options.open(&path).map_err(|_|"Windows web file open refused")?;
  let observed=observe(&file,directory)?;
  if observed.0!=expected.0||(index==0&&(observed.0,observed.1)!=expected){return Err("Windows root/volume changed".into());}
  held.push(file);
 }
 let file=held.last_mut().ok_or("Windows file missing")?;let before=observe(file,false)?;
 if before.2>limit as u64{return Err("Windows web file too large".into());}
 let mut bytes=Vec::new();file.take(limit as u64+1).read_to_end(&mut bytes).map_err(|_|"Windows web file read refused")?;
 let file=held.last().ok_or("Windows file missing")?;let after=observe(file,false)?;
 if bytes.len()>limit||before!=after||bytes.len() as u64!=after.2{return Err("Windows file changed while captured".into());}
 current()?;binding.verify()?;
 Ok(CapturedWebFile{bytes,identity:json!({"volume":after.0,"file_id":after.1,"size":after.2,"last_write":after.3})})
}
