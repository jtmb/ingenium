"""Source semantic checks for the unintegrated payload prototype; no Rust run."""
import hashlib,json
from pathlib import Path
ROOT=Path(__file__).resolve().parent
raw=(ROOT/'resident_payload.rs').read_bytes();source=raw.decode();proposal=(ROOT/'PROPOSAL.md').read_text()
checks={
 'unchanged_64MiB_payload_limit':'const LIMIT:usize=64*1024*1024;' in source,
 'reservation_before_actual_allocation':source.index('compare_exchange_weak')<source.index('std::alloc::alloc_zeroed'),
 'fixed_allocation_no_vec_growth':'Vec::' not in source and 'Layout::array::<u8>(capacity)' in source,
 'allocation_failure_returns_refusal':'if raw.is_null(){return Err(Refused);}' in source,
 'mutable_storage_drops_before_charge':'storage:Box<[u8]>,reservation:Reservation' in source,
 'immutable_storage_drops_before_charge':'storage:Box<[u8]>,_reservation:Reservation' in source,
 'charge_owned_by_shared_allocation':'Arc::new(Allocation{storage,_reservation:reservation})' in source,
 'span_and_cursor_share_actual_allocation':'allocation:self.allocation.clone()' in source and 'payload:self.clone()' in source,
 'only_reservation_drop_releases_counter':source.count('fetch_sub(')==1 and 'impl Drop for Reservation' in source,
 'no_terminal_slot_uncharge_api':'release_for' not in source and 'release_slot' not in source and 'terminal' not in source,
 'five_meaningful_fixtures_supplied':source.count('#[test]')==5,
 'metadata_RSS_and_production_integration_not_claimed':'NOT whole' in proposal and 'unintegrated' in proposal and 'not mounted' in proposal,
 'before_any_DDL_review_boundary':'no DDL' in proposal and 'Allocation8 remains Root-owned' in proposal,
 'private_history_and_no_replay_retained':'minimal' in proposal and 'no-replay' in proposal and 'Remove the lifetime4096 insertion guard' in proposal,
}
assert all(checks.values()),checks
result={'scope':'unintegrated semantic/source proposal only; no production diff or DDL','checks':checks,'passed':len(checks),'rust_fixtures_supplied':5,'rust_fixtures_run':False,
 'compiler_run':False,'runtime_run':False,'activation':False,'prototype_sha256':hashlib.sha256(raw).hexdigest(),
 'remaining':['Root semantic/migration review','actual Runtime intake/source/request/outcome/response/replay integration','bounded charged parser/path/SQLite/HTTP/bookkeeping overhead','incremental BLOB lifetime/hash/forget handling','whole64MiB/20MiB real qualification']}
(ROOT/'review.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({'source_checks_passed':len(checks),'rust_fixtures_run':False,'prototype_sha256':result['prototype_sha256'],'DDL':False}))
