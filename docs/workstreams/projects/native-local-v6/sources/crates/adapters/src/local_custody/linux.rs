//! Portable Linux custody only. Native Linux PTY/engine is not introduced.
use super::*;
use std::os::unix::{fs::{MetadataExt,OpenOptionsExt,DirBuilderExt}};
unsafe extern "C" {fn geteuid()->u32;}
pub(super) struct Held{chain:Vec<File>}
pub(super) fn current_subject()->Result<String>{
 let uid=unsafe{geteuid()};
 let machine=fs::read_to_string("/etc/machine-id").map_err(|_|"machine identity unavailable")?;
 let machine=machine.trim();
 if machine.len()!=32 || !machine.bytes().all(|v|v.is_ascii_hexdigit()){return Err("invalid machine identity".into());}
 Ok(format!("{machine}:{uid}"))
}
fn identity(file:&File)->Result<String>{
 let m=file.metadata().map_err(|_|"held directory metadata")?;
 if !m.is_dir(){return Err("not directory".into());}Ok(format!("{}:{}",m.dev(),m.ino()))
}
pub(super) fn capture(root:&Path)->Result<(Held,String,String)>{
 if !root.is_absolute() || fs::canonicalize(root).map_err(|_|"canonical state")?!=root{return Err("state root not canonical".into());}
 let mut chain=Vec::new();
 for path in root.ancestors().collect::<Vec<_>>().into_iter().rev(){
  let file=fs::OpenOptions::new().read(true).custom_flags(0x20000|0x10000|0x80000).open(path).map_err(|_|"no-follow directory capture")?;
  let held=file.metadata().map_err(|_|"directory metadata")?;
  let named=fs::symlink_metadata(path).map_err(|_|"named directory")?;
  if !held.is_dir()||!named.is_dir()||held.dev()!=named.dev()||held.ino()!=named.ino(){return Err("redirected state ancestor".into());}
  chain.push(file);
 }
 let last=chain.last().ok_or("missing state root")?;
 let m=last.metadata().map_err(|_|"directory metadata")?;
 if m.uid()!=unsafe{geteuid()} || m.mode()&0o077!=0{return Err("state is not private to effective uid".into());}
 let physical=identity(last)?;Ok((Held{chain},current_subject()?,physical))
}
pub(super) fn verify(held:&Held,root:&Path,expected:&str,physical:&str)->Result<()>{
 if current_subject()?!=expected{return Err("effective OS account changed".into());}
 let last=held.chain.last().ok_or("missing held state")?;
 let m=last.metadata().map_err(|_|"held state metadata")?;
 let named=fs::symlink_metadata(root).map_err(|_|"named state unavailable")?;
 if identity(last)?!=physical || named.dev()!=m.dev()||named.ino()!=m.ino()||!named.is_dir()
  ||m.uid()!=unsafe{geteuid()}||m.mode()&0o077!=0{return Err("state custody changed".into());}
 Ok(())
}
pub(super) fn verify_file(path:&Path)->Result<()>{
 let file=fs::OpenOptions::new().read(true).custom_flags(0x20000|0x80000).open(path).map_err(|_|"private file open")?;
 let m=file.metadata().map_err(|_|"private file metadata")?;
 if !m.is_file()||m.uid()!=unsafe{geteuid()}||m.mode()&0o077!=0||m.nlink()!=1{return Err("private file custody mismatch".into());}
 Ok(())
}
pub(super) fn create(path:&Path)->Result<()>{fs::DirBuilder::new().mode(0o700).create(path).map_err(|_|"private create refused; preserve original".into())}
