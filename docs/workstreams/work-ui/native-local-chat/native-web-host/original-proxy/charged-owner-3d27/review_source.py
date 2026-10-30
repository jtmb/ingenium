"""Finite exact composition/source predicates, NOT Rust or runtime tests."""
import hashlib,json,runpy
from pathlib import Path
root=Path(__file__).resolve().parent
scope=runpy.run_path(str(root/'compose.py'))
post=scope['post'];pre=scope['pre'];native=scope['a'].native
payload=(root/'native_web_payload.rs').read_text()
history=(root/'acknowledgement_page.rs').read_text()
worker=(root/'retained_page_worker.rs').read_text()
response=(root/'service_page_response.rs').read_text()
intake=(root/'service_scoped_intake.rs').read_text()
transport=post['crates/adapters/src/opencode/local_web_transport.rs']
original=post['crates/adapters/src/opencode/desktop_runtime/local_workspaces/web_original.rs']
service=post['apps/service/src/routes/local_workspaces/web_original.rs']
checks={
 'exact_preimages_composed':len(post)==18 and len(pre)==18,
 'payload_limit_unchanged': 'const LIMIT:usize=64*1024*1024;' in payload,
 'reserve_before_actual_payload_allocation':payload.index('compare_exchange_weak')<payload.index('alloc_zeroed'),
 'payload_charge_owned_by_actual_allocation':'struct Allocation{bytes:Box<[u8]>,_charge:Charge}' in payload,
 'one_counter_release_site':payload.count('fetch_sub(')==1,
 'no_slot_terminal_uncharge_method':'uncharge(' not in payload and 'release(' not in payload,
 'request_owner_is_charged':'body:Payload' in original and 'body:Arc<[u8]>' not in original,
 'metadata_serialization_charged_before_copy':'json_payload(body.pool()' in original,
 'unused_full_byte_json_escape_removed':'pub fn journal_original(' not in original,
 'raw_intake_no_already_allocated_vec':'intake: NativeWebIntake' in original and 'body: Vec<u8>' not in original,
 'actual_service_capture_adapted':'body: veyra_adapters::opencode::desktop_runtime::NativeWebIntake' in service,
 'actual_private_body_reserved_before_poll':intake.index('begin_local_web_intake')<intake.index('frames.next().await'),
 'private_body_no_collection':all(x not in intake for x in ['.collect(','.to_vec(', 'to_bytes(']),
 'response_reservation_precedes_request_send':transport.index('allocate(LIMIT+1)')<transport.index('let request=request.body'),
 'actual_reqwest_body_owns_charged_cursor':'Body::sized(effective_body.cursor(),length)' in transport,
 'response_observer_no_vec_growth':'pub body:Buffer' in transport and 'observed.body.read_once(response' in transport and 'observed.body.extend_from_slice' not in transport,
 'history_reserves_before_query_and_open':history.index('pool.allocate(PAGE)')<history.index('tx.query_row(')<history.index('tx.blob_open('),
 'history_no_full_blob_load_or_substr':all(x not in history for x in ['Vec<u8>','substr(', 'r.get(4)?,r.get(5)?,r.get(6)?']),
 'history_no_new_json_ast':'serde_json::Value' not in history and 'serde_json::from_' not in history,
 'same_blob_for_hash_and_page':history.count('tx.blob_open(')==1 and history.count('blob.read_at_exact(')==2,
 'checked_close_before_read_result_and_commit':history.index('close_result=custody.close_actual(blob)')<history.index('close_result?;read_result?;')<history.index('tx.commit()?'),
 'close_error_latched_before_consuming_close':history.index('*s=ReadState::CloseFailed;')<history.index('blob.close()?;'),
 'join_failure_latched_before_handle_take':worker.index('s.phase=Phase::JoinFailed;')<worker.index('s.handle.take()'),
 'worker_registry_retained_before_spawn':response.index('registry.push(job.clone())')<response.index('job.worker.start_once('),
 'actual_join_required_before_page_handoff':response.index('job.worker.reconcile()')<response.index('job.worker.take_joined()'),
 'actual_http_bytes_keep_owner':'Bytes::from_owner(payload)' in response,
 'handoff_checks_forget_under_original_writer':'handoff_native_web_acknowledgement_page' in history and 'local_web_original_forget_receipts' in history,
 'old_full_ack_reader_not_called':'read_native_web_acknowledgement(' not in service,
 'service_submit_returns_real_response':'Result<axum::response::Response,String>' in service,
 'new_connection_writer_not_created':all(x not in history+response for x in ['Connection::open','ProjectStore::open','connect(']),
 'no_public_auth_route_minted':'.route(' not in intake+response,
 'all_complete_acceptance_gates_explicit':all(x in (root/'INTEGRATION-GATES.md').read_text() for x in ['uncharged','20MiB','UNRUN','No DDL']),
 'seven_rust_fixtures_supplied_unrun':payload.count('#[test]')+worker.count('#[test]')==7,
}
assert all(checks.values()),checks
result={'scope':'unapplied owned-source composition and semantic predicates only','checks':checks,'passed':sum(checks.values()),'rust_fixtures_supplied':7,'rust_fixtures_run':False,'compiler_run':False,'sqlite_or_native_runtime_run':False,'ddl_written':False,'dependency_feature_activated':False,'full_memory_or_20MiB_qualified':False,'patch_bytes':(root/'integration.patch').stat().st_size,'patch_sha256':hashlib.sha256((root/'integration.patch').read_bytes()).hexdigest(),'frozen7_sha256':hashlib.sha256((native/'crates/adapters/src/projects/0007.sql').read_bytes()).hexdigest()}
(root/'review.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({'passed':result['passed'],'rust_fixtures_run':False,'patch_sha256':result['patch_sha256']}))
