"""Exact source review only; actual Rust/SQLite busy-close test is UNRUN."""
import ast,hashlib,json,re,runpy
from pathlib import Path
ROOT=Path(__file__).resolve().parent
n=runpy.run_path(str(ROOT/'compose.py'));before,after=n['before'],n['after']
close=after[n['CLOSE']];test=after[n['TEST']];busy=after[n['BUSY']]
checks={
 'complete_original_preserved_on_refusal':close.count('Self { connection, local_custody, local_installation_id, native_web_writer }')==2,
 'no_replacement_writer_created': 'NativeWebWriterOriginal::new' not in close,
 'actual_busy_fixture_captures_original_writer':'let original_writer=store.native_web_writer.clone();' in test,
 'actual_busy_fixture_checks_same_writer':'Arc::ptr_eq(&store.native_web_writer,&self.original_writer)' in test,
 'existing_refusal_checks_still_twice':test.count('fixture.assert_same_handle_and_statement_usable();')==2,
 'close_current_schema_setup':test.index('include_str!("../0005.sql")')<test.index('super::super::validate_schema(&connection, super::super::SCHEMA_VERSION)'),
 'busy_current_schema_setup':busy.index('include_str!("../0005.sql")')<busy.index('validate_schema(&connection, SCHEMA_VERSION)'),
}
assert all(checks.values()),checks
module=ast.parse((ROOT.parent/'windows-join-492f'/'review.py').read_text());function=next(f for f in module.body if isinstance(f,ast.FunctionDef) and f.name=='apply_exact')
namespace={'re':re};exec(compile(ast.Module(body=[function],type_ignores=[]),'<frozen pure patch interpreter>','exec'),namespace)
actual=namespace['apply_exact'](before,(ROOT/'store-close-identity.patch').read_text());manifest=json.loads((ROOT/'manifest.json').read_text())
checks['exact_three_postimages']=all(hashlib.sha256(actual[f['path']].encode()).hexdigest()==f['postimage_sha256'] for f in manifest['files'])
assert checks['exact_three_postimages']
(ROOT/'review.json').write_text(json.dumps({'scope':'source/exact composition only','checks':checks,'passed':len(checks),'compiler_run':False,'rust_busy_sqlite_regression_run':False,'production_migration_changed':False,'activation':False},indent=2)+'\n')
print(json.dumps({'source_checks_passed':len(checks),'compiler_run':False,'rust_busy_sqlite_regression_run':False}))
