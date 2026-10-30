//! Synchronous existing-only CreateFileW wrappers. Genuine handles are retained
//! before observation and are transferred once into existing checked-close slots.
use super::*;
use std::{fs::{File,OpenOptions},io::Read,mem::ManuallyDrop,os::windows::{fs::OpenOptionsExt,io::{AsRawHandle,IntoRawHandle}},path::PathBuf};
use crate::model::windows_process::checked_close::{CheckedHandleClose,CloseState};
use windows_sys::Win32::{Storage::FileSystem::*,Foundation::GetHandleInformation};
#[derive(Clone,PartialEq,Eq)]struct Stamp{volume:u64,id:[u8;16],size:u64,write:i64}
struct Node{file:Option<ManuallyDrop<File>>,close:CheckedHandleClose,directory:bool,stamp:Option<Stamp>}
pub(crate) struct Source{pub(crate) bytes:Vec<u8>,pub(crate) mime:String,pub(crate) absolute:String}
#[derive(Default)]pub(super) struct Held{nodes:Vec<Node>,pub(super) sources:Vec<Source>}
// All genuine originals and checked-close slots have a single private mutex
// owner; raw HANDLE values are never copied to a caller or another close path.
unsafe impl Send for Held{}
fn observe(file:&File,directory:bool)->Result<Stamp,String>{
 let handle=file.as_raw_handle().cast();let mut id:FILE_ID_INFO=unsafe{std::mem::zeroed()};
 let mut info:FILE_STANDARD_INFO=unsafe{std::mem::zeroed()};let mut tags:FILE_ATTRIBUTE_TAG_INFO=unsafe{std::mem::zeroed()};
 let mut basic:FILE_BASIC_INFO=unsafe{std::mem::zeroed()};let mut flags=0u32;
 if unsafe{GetFileType(handle)}!=FILE_TYPE_DISK
  ||unsafe{GetFileInformationByHandleEx(handle,FileIdInfo,(&mut id as *mut FILE_ID_INFO).cast(),size_of::<FILE_ID_INFO>() as u32)}==0
  ||unsafe{GetFileInformationByHandleEx(handle,FileStandardInfo,(&mut info as *mut FILE_STANDARD_INFO).cast(),size_of::<FILE_STANDARD_INFO>() as u32)}==0
  ||unsafe{GetFileInformationByHandleEx(handle,FileAttributeTagInfo,(&mut tags as *mut FILE_ATTRIBUTE_TAG_INFO).cast(),size_of::<FILE_ATTRIBUTE_TAG_INFO>() as u32)}==0
  ||unsafe{GetFileInformationByHandleEx(handle,FileBasicInfo,(&mut basic as *mut FILE_BASIC_INFO).cast(),size_of::<FILE_BASIC_INFO>() as u32)}==0
  ||unsafe{GetHandleInformation(handle,&mut flags)}==0||flags&1!=0||tags.FileAttributes&FILE_ATTRIBUTE_REPARSE_POINT!=0||tags.ReparseTag!=0
  ||(info.Directory!=0)!=directory||info.DeletePending!=0||info.EndOfFile<0||(!directory&&info.NumberOfLinks!=1)||id.VolumeSerialNumber==0||id.FileId.Identifier==[0;16]{return Err("held Windows original observation refused".into());}
 Ok(Stamp{volume:id.VolumeSerialNumber,id:id.FileId.Identifier,size:if directory{0}else{info.EndOfFile as u64},write:if directory{0}else{basic.LastWriteTime}})
}
fn components(path:&str)->Result<Vec<String>,String>{
 let value=path.replace('/',"\\");let b=value.as_bytes();
 if b.len()<3||!b[0].is_ascii_alphabetic()||b[1]!=b':'||b[2]!=b'\\'||value.starts_with("\\\\")||value.encode_utf16().count()>32760{return Err("local drive path required".into());}
 let mut parts=vec![value[..3].to_owned()];
 for part in value[3..].trim_end_matches('\\').split('\\'){
  if part.is_empty()||part=="."||part==".."||part.ends_with(['.',' '])||part.encode_utf16().count()>255
   ||part.chars().any(|c|c.is_control()||"<>:\"/\\|?*".contains(c))||parts.len()>128{return Err("Windows original path component refused".into());}
  parts.push(part.into());
 }Ok(parts)
}
impl Held{
 pub(super) fn capture(&mut self,binding:&LocalWorkspaceBinding,files:&[String],batch_limit:usize,current:&dyn Fn()->Result<(),String>)->Result<(),String>{
  if !self.nodes.is_empty()||!self.sources.is_empty(){return Err("original capture is spent".into());}
  let expected:(u64,[u8;16])=serde_json::from_str(&binding.physical).map_err(|_|"actual saved root identity unavailable")?;
  let root=components(binding.directory())?;let mut total=0usize;
  for absolute in files{
   let path_parts=components(absolute)?;
   if path_parts.len()<=root.len()||!path_parts.iter().zip(&root).all(|(a,b)|a.eq_ignore_ascii_case(b)){return Err("foreign original path".into());}
   let mut path=PathBuf::new();let first=self.nodes.len();
   for (index,part) in path_parts.iter().enumerate(){
    current()?;binding.verify()?;path.push(part);let directory=index+1<path_parts.len();
    let file=OpenOptions::new().read(true).share_mode(FILE_SHARE_READ)
     .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT|if directory{FILE_FLAG_BACKUP_SEMANTICS}else{0})
     .open(&path).map_err(|_|"read-sharing open refused; preserve original")?;
    // File owns a successful synchronous CreateFile result. Enroll it BEFORE
    // any fallible query. Failed queries cannot drop an unretained original.
    self.nodes.push(Node{file:Some(ManuallyDrop::new(file)),close:CheckedHandleClose::empty(),directory,stamp:None});
    let node=self.nodes.last_mut().ok_or("held node missing")?;let file=node.file.as_deref().ok_or("held handle missing")?;
    let stamp=observe(file,directory)?;
    if stamp.volume!=expected.0||(index+1==root.len()&&(stamp.volume,stamp.id)!=expected){return Err("actual root/volume differs from binding".into());}
    if index==0{
     let mut native=vec![0u16;32768];let n=unsafe{GetFinalPathNameByHandleW(file.as_raw_handle().cast(),native.as_mut_ptr(),native.len() as u32,VOLUME_NAME_NT)} as usize;
     if n==0||n>=native.len(){return Err("actual volume path unavailable".into());}
     let name=String::from_utf16(&native[..n]).map_err(|_|"volume path invalid")?;
     let number=name.strip_prefix("\\Device\\HarddiskVolume").ok_or("local block volume required")?.trim_end_matches('\\');
     if number.is_empty()||!number.bytes().all(|b|b.is_ascii_digit()){return Err("SUBST/network/volume alias refused".into());}
    }
    node.stamp=Some(stamp);
   }
   let node=self.nodes.last().ok_or("regular original missing")?;let file=node.file.as_deref().ok_or("regular handle missing")?;
   let remaining=batch_limit.checked_sub(total).ok_or("source batch full")?;
   if node.stamp.as_ref().ok_or("source identity missing")?.size>remaining as u64{return Err("source batch size refused".into());}
   let mut bytes=Vec::new();file.take(remaining as u64+1).read_to_end(&mut bytes).map_err(|_|"held source read refused")?;
   total=total.checked_add(bytes.len()).filter(|n|*n<=batch_limit).ok_or("source bound exceeded")?;
   let (mime,_)=crate::attachments::sniff_for_prompt(&bytes).map_err(|_|"source MIME unsupported by current native policy")?;
   if self.nodes[first..].iter().any(|node|node.file.as_deref().and_then(|file|observe(file,node.directory).ok()).as_ref()!=node.stamp.as_ref()){return Err("held chain changed".into());}
   self.sources.push(Source{bytes,mime:mime.into(),absolute:absolute.clone()});
  }current()?;binding.verify()?;self.check()
 }
 pub(super) fn check(&self)->Result<(),String>{
  for node in &self.nodes{
   if node.close.state()!=CloseState::Empty||node.file.as_deref().and_then(|file|observe(file,node.directory).ok()).as_ref()!=node.stamp.as_ref(){return Err("original held chain unavailable".into());}
  }Ok(())
 }
 pub(super) fn close_once(&mut self,deadline:Instant)->Result<(),String>{
  for node in &self.nodes{if node.close.state()!=CloseState::Empty||node.file.is_none(){return Err("original close already attempted".into());}}
  for node in self.nodes.iter_mut().rev(){
   if Instant::now()>=deadline{return Err("held original close deadline".into());}
   let file=node.file.take().ok_or("close source missing")?;let mut raw=file.as_raw_handle().cast();
   if node.close.prepare(&mut raw).is_err(){node.file=Some(file);return Err("held original transfer refused".into());}
   let _=ManuallyDrop::into_inner(file).into_raw_handle();
   #[cfg(not(test))]unsafe{node.close.close_native().map_err(|_|"held original checked close unknown")?;}
   #[cfg(test)]return Err("native checked close requires actual qualification".into());
  }self.sources.clear();Ok(())
 }
}
