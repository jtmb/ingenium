//! Actual backing allocations own resident-payload charges. No physical proof.
use std::{io::{self,Read},ops::{Deref,Range},sync::{Arc,atomic::{AtomicUsize,Ordering}}};
const LIMIT:usize=64*1024*1024;
pub(crate) struct Pool{used:AtomicUsize,limit:usize}
#[derive(Debug)]pub(crate) struct Refused;
impl Pool{
 pub(crate) fn for_registry()->Arc<Self>{Arc::new(Self{used:AtomicUsize::new(0),limit:LIMIT})}
 pub(crate) fn allocate(self:&Arc<Self>,capacity:usize)->Result<Buffer,Refused>{
  if capacity==0{return Err(Refused)}
  let mut old=self.used.load(Ordering::Acquire);
  loop{let next=old.checked_add(capacity).filter(|n|*n<=self.limit).ok_or(Refused)?;
   match self.used.compare_exchange_weak(old,next,Ordering::AcqRel,Ordering::Acquire){Ok(_)=>break,Err(actual)=>old=actual}}
  let charge=Charge{pool:self.clone(),capacity};
  let layout=std::alloc::Layout::array::<u8>(capacity).map_err(|_|Refused)?;
  let ptr=unsafe{std::alloc::alloc_zeroed(layout)};
  if ptr.is_null(){return Err(Refused)}
  // Nonzero exact initialized u8 layout from global allocator; Box frees same.
  let bytes=unsafe{Box::from_raw(std::ptr::slice_from_raw_parts_mut(ptr,capacity))};
  Ok(Buffer{allocation:Arc::new(Allocation{bytes,_charge:charge}),length:0})
 }
 pub(crate) fn used(&self)->usize{self.used.load(Ordering::Acquire)} // telemetry only
}
struct Charge{pool:Arc<Pool>,capacity:usize}
impl Drop for Charge{fn drop(&mut self){let prior=self.pool.used.fetch_sub(self.capacity,Ordering::AcqRel);debug_assert!(prior>=self.capacity);}}
struct Allocation{bytes:Box<[u8]>,_charge:Charge} // actual bytes drop FIRST
pub(crate) struct Buffer{allocation:Arc<Allocation>,length:usize}
impl Buffer{
 pub(crate) fn len(&self)->usize{self.length}
 pub(crate) fn is_empty(&self)->bool{self.length==0}
 pub(crate) fn capacity(&self)->usize{self.allocation.bytes.len()}
 pub(crate) fn refill<E>(&mut self,length:usize,fill:impl FnOnce(&mut[u8])->Result<(),E>)->Result<(),Option<E>>{
  if length>self.capacity(){return Err(None)}
  let actual=Arc::get_mut(&mut self.allocation).ok_or(None)?;
  self.length=0;fill(&mut actual.bytes[..length]).map_err(Some)?;self.length=length;Ok(())
 }
 pub(crate) fn append(&mut self,bytes:&[u8])->Result<(),Refused>{
  let end=self.length.checked_add(bytes.len()).filter(|n|*n<=self.capacity()).ok_or(Refused)?;
  let actual=Arc::get_mut(&mut self.allocation).ok_or(Refused)?;
  actual.bytes[self.length..end].copy_from_slice(bytes);self.length=end;Ok(())
 }
 pub(crate) fn read_once(&mut self,input:&mut impl Read,maximum:usize)->io::Result<usize>{
  let end=self.capacity().min(self.length.saturating_add(maximum));
  if end==self.length{return Err(io::Error::other("charged capacity exhausted"))}
  let actual=Arc::get_mut(&mut self.allocation).ok_or_else(||io::Error::other("payload already shared"))?;
  let count=input.read(&mut actual.bytes[self.length..end])?;
  if count>end-self.length{return Err(io::Error::other("reader exceeded destination"))}
  self.length+=count;Ok(count)
 }
 pub(crate) fn share(&self)->Payload{Payload{allocation:self.allocation.clone(),range:0..self.length}}
 pub(crate) fn freeze(self)->Payload{Payload{allocation:self.allocation,range:0..self.length}}
}
impl AsRef<[u8]> for Buffer{fn as_ref(&self)->&[u8]{&self.allocation.bytes[..self.length]}}
impl Deref for Buffer{type Target=[u8];fn deref(&self)->&[u8]{self.as_ref()}}
pub(crate) fn json_payload(pool:&Arc<Pool>,value:&impl serde::Serialize)->Result<Payload,Refused>{
 struct Counter(usize);impl io::Write for Counter{fn write(&mut self,b:&[u8])->io::Result<usize>{self.0=self.0.checked_add(b.len()).ok_or_else(||io::Error::other("length overflow"))?;Ok(b.len())}fn flush(&mut self)->io::Result<()>{Ok(())}}
 impl io::Write for Buffer{fn write(&mut self,b:&[u8])->io::Result<usize>{self.append(b).map_err(|_|io::Error::other("charged destination exhausted"))?;Ok(b.len())}fn flush(&mut self)->io::Result<()>{Ok(())}}
 let mut count=Counter(0);serde_json::to_writer(&mut count,value).map_err(|_|Refused)?;
 let mut actual=pool.allocate(count.0.max(1))?;serde_json::to_writer(&mut actual,value).map_err(|_|Refused)?;Ok(actual.freeze())
}
/// Opaque, no public mint/Deserialize/into_vec or counter-release method.
pub struct Payload{allocation:Arc<Allocation>,range:Range<usize>}
impl Clone for Payload{fn clone(&self)->Self{Self{allocation:self.allocation.clone(),range:self.range.clone()}}}
impl Payload{
 pub fn len(&self)->usize{self.range.len()}
 pub fn is_empty(&self)->bool{self.range.is_empty()}
 pub(crate) fn belongs_to(&self,pool:&Arc<Pool>)->bool{Arc::ptr_eq(&self.allocation._charge.pool,pool)}
 pub(crate) fn pool(&self)->&Arc<Pool>{&self.allocation._charge.pool}
 pub fn span(&self,range:Range<usize>)->Option<Self>{
  if range.start>range.end||range.end>self.len(){return None}
  Some(Self{allocation:self.allocation.clone(),range:self.range.start+range.start..self.range.start+range.end})
 }
 pub fn cursor(&self)->Cursor{Cursor{body:self.clone(),offset:0}}
 #[cfg(test)]pub(crate) fn owner_count(&self)->usize{Arc::strong_count(&self.allocation)}
}
impl AsRef<[u8]> for Payload{fn as_ref(&self)->&[u8]{&self.allocation.bytes[self.range.clone()]}}
impl Deref for Payload{type Target=[u8];fn deref(&self)->&[u8]{self.as_ref()}}
pub struct Cursor{body:Payload,offset:usize}
impl Read for Cursor{fn read(&mut self,out:&mut[u8])->io::Result<usize>{let n=out.len().min(self.body.len()-self.offset);out[..n].copy_from_slice(&self.body.as_ref()[self.offset..self.offset+n]);self.offset+=n;Ok(n)}}

#[cfg(test)]mod tests{
 use super::*;
 fn small(n:usize)->Arc<Pool>{Arc::new(Pool{used:AtomicUsize::new(0),limit:n})}
 #[test]fn response_cursor_and_one_byte_span_keep_entire_capacity(){
  let p=small(64);let mut b=p.allocate(64).unwrap();b.append(b"exact").unwrap();let body=b.freeze();let page=body.span(0..1).unwrap();let mut response=page.cursor();
  drop(body);drop(page);assert_eq!(p.used(),64);assert!(p.allocate(1).is_err());let mut one=[0];response.read_exact(&mut one).unwrap();assert_eq!(one,[b'e']);drop(response);assert_eq!(p.used(),0);
 }
 #[test]fn shared_body_refuses_mutation_and_does_not_detach_charge(){
  let p=small(8);let mut b=p.allocate(8).unwrap();b.append(b"x").unwrap();let last=b.share();assert!(b.append(b"y").is_err());drop(b);assert_eq!(last.as_ref(),b"x");assert_eq!(p.used(),8);drop(last);assert_eq!(p.used(),0);
 }
 #[test]fn refused_growth_keeps_prefix_and_other_owner(){
  let p=small(4);let mut b=p.allocate(4).unwrap();b.append(b"raw").unwrap();assert!(b.append(b"!!").is_err());assert_eq!(b.as_ref(),b"raw");assert!(p.allocate(1).is_err());drop(b);assert_eq!(p.used(),0);
 }
 #[test]fn read_error_keeps_actual_prefix(){
  struct Fault;impl Read for Fault{fn read(&mut self,_:&mut[u8])->io::Result<usize>{Err(io::Error::other("fault"))}}
  let p=small(8);let mut b=p.allocate(8).unwrap();b.append(b"prefix").unwrap();assert!(b.read_once(&mut Fault,2).is_err());assert_eq!(b.as_ref(),b"prefix");assert_eq!(p.used(),8);
 }
}
