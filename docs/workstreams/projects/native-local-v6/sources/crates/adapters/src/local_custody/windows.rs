use super::*;
use std::{os::windows::{ffi::OsStrExt,io::{AsRawHandle,FromRawHandle}},ptr};
use windows_sys::Win32::{Foundation::{INVALID_HANDLE_VALUE,LocalFree},
 Security::{Authorization::ConvertStringSecurityDescriptorToSecurityDescriptorW,*,},
 Storage::FileSystem::*};
fn open(path:&Path,directory:bool)->Result<File>{
 let name:Vec<u16>=path.as_os_str().encode_wide().chain(Some(0)).collect();
 let flags=FILE_FLAG_OPEN_REPARSE_POINT|if directory{FILE_FLAG_BACKUP_SEMANTICS}else{0};
 let handle=unsafe{CreateFileW(name.as_ptr(),READ_CONTROL|FILE_READ_ATTRIBUTES,
  FILE_SHARE_READ|FILE_SHARE_WRITE,ptr::null(),OPEN_EXISTING,flags,ptr::null_mut())};
 if handle==INVALID_HANDLE_VALUE{return Err("cannot retain original directory/file".into());}
 let file=unsafe{File::from_raw_handle(handle.cast())};
 let mut attributes:FILE_ATTRIBUTE_TAG_INFO=unsafe{std::mem::zeroed()};
 if unsafe{GetFileInformationByHandleEx(file.as_raw_handle().cast(),FileAttributeTagInfo,
  (&mut attributes as *mut FILE_ATTRIBUTE_TAG_INFO).cast(),std::mem::size_of_val(&attributes) as u32)}==0
  || attributes.FileAttributes&FILE_ATTRIBUTE_REPARSE_POINT!=0
  || ((attributes.FileAttributes&FILE_ATTRIBUTE_DIRECTORY!=0)!=directory)
 {return Err("redirected/wrong-kind original".into());}
 Ok(file)
}
pub(super) fn verify_file(path:&Path)->Result<()>{
 let file=open(path,false)?;
 let mut info:BY_HANDLE_FILE_INFORMATION=unsafe{std::mem::zeroed()};
 if unsafe{GetFileInformationByHandle(file.as_raw_handle().cast(),&mut info)}==0||info.nNumberOfLinks!=1{return Err("private file link custody".into());}
 crate::windows_acl::verify_private_inherited_file(&file)
}
pub(super) fn create(path:&Path)->Result<()>{
 let sid=crate::windows_acl::owner_sid()?;
 let sddl:Vec<u16>=format!("O:{sid}D:P(A;OICI;FA;;;{sid})").encode_utf16().chain(Some(0)).collect();
 let name:Vec<u16>=path.as_os_str().encode_wide().chain(Some(0)).collect();
 let mut descriptor=ptr::null_mut();
 if unsafe{ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl.as_ptr(),1,&mut descriptor,ptr::null_mut())}==0
 {return Err("private directory descriptor unavailable".into());}
 let attributes=SECURITY_ATTRIBUTES{nLength:std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
  lpSecurityDescriptor:descriptor,bInheritHandle:0};
 let result=unsafe{CreateDirectoryW(name.as_ptr(),&attributes)};
 unsafe{LocalFree(descriptor.cast());}
 if result==0{return Err("private directory name already exists or create is uncertain; never adopt it".into());}
 Ok(())
}
