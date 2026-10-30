//! Unintegrated semantic prototype: payload capacity follows its actual owner.
//! No effect/read/transport/database-close authority is created here.
use std::{io::{self,Read},ops::Range,sync::{Arc,atomic::{AtomicUsize,Ordering}}};
const LIMIT:usize=64*1024*1024;
// Bookkeeping/allocator/RSS bounds are a separate required integration proof.
// This primitive charges exact requested payload capacity, never slice length.
pub(super) struct ResidentPayloadPool{used:AtomicUsize,limit:usize}
impl ResidentPayloadPool{
 pub(super) fn for_actual_runtime()->Arc<Self>{Arc::new(Self{used:AtomicUsize::new(0),limit:LIMIT})}
 pub(super) fn used_capacity(&self)->usize{self.used.load(Ordering::Acquire)}
 pub(super) fn allocate(self:&Arc<Self>,capacity:usize)->Result<MutablePayload,Refused>{
  if capacity==0{return Err(Refused);} // canonical empty bodies need no allocation
  let mut previous=self.used.load(Ordering::Acquire);
  loop{
   let next=previous.checked_add(capacity).filter(|n|*n<=self.limit).ok_or(Refused)?;
   match self.used.compare_exchange_weak(previous,next,Ordering::AcqRel,Ordering::Acquire){Ok(_)=>break,Err(actual)=>previous=actual}
  }
  let reservation=Reservation{pool:self.clone(),capacity};
  // Known-size fallible allocation: no Vec growth/shrink/reallocation or copy.
  let layout=std::alloc::Layout::array::<u8>(capacity).map_err(|_|Refused)?;
  let raw=unsafe{std::alloc::alloc_zeroed(layout)};
  if raw.is_null(){return Err(Refused);} // releases only this unused reservation
  // SAFETY: nonzero exact u8 slice layout, global allocator, initialized zeros;
  // Box owns this allocation and will deallocate with the identical layout.
  let storage=unsafe{Box::from_raw(std::ptr::slice_from_raw_parts_mut(raw,capacity))};
  Ok(MutablePayload{storage,reservation})
 }
}
#[derive(Debug)]pub(super) struct Refused;
struct Reservation{pool:Arc<ResidentPayloadPool>,capacity:usize}
impl Drop for Reservation{
 fn drop(&mut self){
  // This counter is not a positive retirement predicate. It is decremented
  // only when the allocation's actual private reservation is dropped.
  let previous=self.pool.used.fetch_sub(self.capacity,Ordering::AcqRel);
  debug_assert!(previous>=self.capacity);
 }
}
pub(super) struct MutablePayload{
 // Declaration order matters: actual payload storage drops BEFORE reservation.
 storage:Box<[u8]>,reservation:Reservation,
}
impl MutablePayload{
 pub(super) fn writable(&mut self)->&mut[u8]{&mut self.storage}
 pub(super) fn freeze(self,length:usize)->Result<Payload,Self>{
  if length>self.storage.len(){return Err(self);}
  let Self{storage,reservation}=self;
  Ok(Payload{allocation:Arc::new(Allocation{storage,_reservation:reservation}),range:0..length})
 }
}
struct Allocation{
 // Last Arc destruction frees the entire capacity before releasing its charge.
 storage:Box<[u8]>,_reservation:Reservation,
}
pub(super) struct Payload{allocation:Arc<Allocation>,range:Range<usize>}
impl Clone for Payload{fn clone(&self)->Self{Self{allocation:self.allocation.clone(),range:self.range.clone()}}}
impl Payload{
 pub(super) fn span(&self,range:Range<usize>)->Option<Self>{
  if range.start>range.end||range.end>self.range.len(){return None;}
  Some(Self{allocation:self.allocation.clone(),range:self.range.start+range.start..self.range.start+range.end})
 }
 pub(super) fn len(&self)->usize{self.range.len()}
 pub(super) fn cursor(&self)->PayloadCursor{PayloadCursor{payload:self.clone(),position:0}}
 // No into_vec/detach/uncharge API. All production copies must allocate another
 // charged destination BEFORE copying. The integration must audit consumers.
}
impl AsRef<[u8]> for Payload{fn as_ref(&self)->&[u8]{&self.allocation.storage[self.range.clone()]}}
pub(super) struct PayloadCursor{payload:Payload,position:usize}
impl Read for PayloadCursor{
 fn read(&mut self,output:&mut[u8])->io::Result<usize>{
  let count=output.len().min(self.payload.len()-self.position);
  output[..count].copy_from_slice(&self.payload.as_ref()[self.position..self.position+count]);self.position+=count;Ok(count)
 }
}

#[cfg(test)]mod tests{
 use super::*;
 fn small(limit:usize)->Arc<ResidentPayloadPool>{Arc::new(ResidentPayloadPool{used:AtomicUsize::new(0),limit})}
 #[test]fn response_and_replay_owners_keep_same_allocation_charged(){
  let pool=small(1024);let mut mutable=pool.allocate(512).unwrap();mutable.writable()[..4].copy_from_slice(b"body");
  let original=mutable.freeze(4).ok().unwrap();let response=original.clone();let mut replay=response.cursor();
  drop(original);drop(response);assert_eq!(pool.used_capacity(),512);
  let mut received=[0;4];replay.read_exact(&mut received).unwrap();assert_eq!(&received,b"body");
  drop(replay);assert_eq!(pool.used_capacity(),0);
 }
 #[test]fn one_byte_subrange_retains_charge_for_whole_backing_allocation(){
  let pool=small(1024);let original=pool.allocate(1024).unwrap().freeze(1024).ok().unwrap();
  let last=original.span(0..1).unwrap();drop(original);assert_eq!(pool.used_capacity(),1024);
  assert!(pool.allocate(1).is_err());drop(last);assert_eq!(pool.used_capacity(),0);
 }
 #[test]fn quota_refusal_precedes_allocation_and_does_not_charge_or_release_another_owner(){
  let pool=small(1024);assert!(pool.allocate(1025).is_err());assert_eq!(pool.used_capacity(),0);
  let retained=pool.allocate(900).unwrap();assert!(pool.allocate(125).is_err());assert_eq!(pool.used_capacity(),900);
  drop(retained);assert_eq!(pool.used_capacity(),0);
 }
 #[test]fn unused_capacity_stays_charged_even_when_logical_body_is_short(){
  let pool=small(1024);let body=pool.allocate(1024).unwrap().freeze(1).ok().unwrap();
  assert_eq!(body.len(),1);assert_eq!(pool.used_capacity(),1024);drop(body);assert_eq!(pool.used_capacity(),0);
 }
 #[test]fn invalid_freeze_returns_same_actual_allocation_and_charge(){
  let pool=small(8);let mutable=pool.allocate(8).unwrap();let original=mutable.freeze(9).err().unwrap();
  assert_eq!(pool.used_capacity(),8);drop(original);assert_eq!(pool.used_capacity(),0);
 }
}
