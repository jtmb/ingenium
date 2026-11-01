from pathlib import Path
import contextlib,copy,gzip,hashlib,importlib.util,io,tarfile,unittest
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('oci_layer',Path(__file__).resolve().parents[1]/'ops/oci_artifact_layer.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
ROOT=Path(__file__).resolve().parents[1]
def file_row(name='node_modules/pkg/index.js',body=b'fixture'):
 return {'type':'file','source':name,'target':'/app/'+name,'bytes':len(body),'sha256':hashlib.sha256(body).hexdigest(),'sourceMode':0o644,'targetMode':0o644}
class LayerTests(unittest.TestCase):
 def write(self,rows=None,body=b'fixture',**kwargs):
  out=io.BytesIO();rows=rows if rows is not None else[file_row(body=body)]
  @contextlib.contextmanager
  def source(root,row):yield io.BytesIO(body)
  with patch.object(m,'_source_bytes',source):
   receipt=m.write_layer(ROOT,rows,out,source_date_epoch=1700000000,**kwargs)
  return receipt,out.getvalue()
 def refuse(self,mutate,code):
  rows=[file_row()];mutate(rows);out=io.BytesIO()
  with self.assertRaisesRegex(m.ArtifactLayerError,code):m.write_layer(ROOT,rows,out,source_date_epoch=1700000000)
  self.assertEqual(out.getvalue(),b'')
 def test_deterministic_complete_layer_and_hashes(self):
  a,body=self.write();b,again=self.write()
  self.assertEqual(a,b);self.assertEqual(body,again)
  raw=gzip.decompress(body)
  self.assertEqual(a['digest'],'sha256:'+hashlib.sha256(body).hexdigest())
  self.assertEqual(a['diffId'],'sha256:'+hashlib.sha256(raw).hexdigest())
  self.assertEqual(a['size'],len(body));self.assertEqual(a['uncompressedBytes'],len(raw))
  with tarfile.open(fileobj=io.BytesIO(raw))as archive:
   entries=archive.getmembers();member=archive.getmember('app/node_modules/pkg/index.js')
   self.assertEqual(archive.extractfile(member).read(),b'fixture')
   self.assertEqual((member.uid,member.gid,member.mode,member.mtime),(0,0,0o644,1700000000))
   self.assertEqual({e.name for e in entries if e.isdir()},{'app','app/node_modules','app/node_modules/pkg'})
  self.assertFalse(a['finalImageRuntimeOrPublicationAccepted'])
 def test_empty_manifest_refused(self):self.refuse(lambda r:r.clear(),'ROWS_BOUND')
 def test_duplicate_targets_refused(self):self.refuse(lambda r:r.append(dict(r[0])),'TARGET_DUPLICATE')
 def test_source_traversal_refused(self):self.refuse(lambda r:r[0].update(source='../secret'),'SOURCE_PATH')
 def test_absolute_source_refused(self):self.refuse(lambda r:r[0].update(source='/secret'),'SOURCE_PATH')
 def test_source_backslash_refused(self):self.refuse(lambda r:r[0].update(source='node_modules'+chr(92)+'secret'),'SOURCE_PATH')
 def test_target_outside_app_refused(self):self.refuse(lambda r:r[0].update(target='/etc/passwd'),'TARGET_PATH')
 def test_target_traversal_refused(self):self.refuse(lambda r:r[0].update(target='/app/a/../b'),'TARGET_PATH')
 def test_mutable_mode_refused(self):self.refuse(lambda r:r[0].update(targetMode=0o666),'TARGET_MODE')
 def test_setuid_mode_refused(self):self.refuse(lambda r:r[0].update(targetMode=0o4755),'TARGET_MODE')
 def test_hardlink_refused(self):self.refuse(lambda r:r[0].update(type='hardlink'),'ROW_TYPE')
 def test_bad_file_digest_refused(self):self.refuse(lambda r:r[0].update(sha256='abc'),'FILE_BOUND_OR_DIGEST')
 def test_directory_parent_alias_refused(self):
  self.refuse(lambda r:r.append({'type':'symlink','target':'/app/node_modules/pkg','link':'else'}),'PARENT_NOT_DIRECTORY')
 def test_dangling_link_refused(self):
  self.refuse(lambda r:r.append({'type':'symlink','target':'/app/alias','link':'missing'}),'LINK_TARGET_UNQUALIFIED')
 def test_symlink_cycles_refused(self):
  self.refuse(lambda r:r.extend([{'type':'symlink','target':'/app/a','link':'b'},{'type':'symlink','target':'/app/b','link':'a'}]),'LINK_TARGET_UNQUALIFIED')
 def test_outside_link_refused(self):
  self.refuse(lambda r:r.append({'type':'symlink','target':'/app/alias','link':'../etc/passwd'}),'TARGET_PATH')
 def test_valid_bin_link(self):
  row=file_row();rows=[row,{'type':'symlink','target':'/app/node_modules/.bin/pkg','link':'../pkg/index.js'}]
  receipt,body=self.write(rows)
  with tarfile.open(fileobj=io.BytesIO(gzip.decompress(body)))as archive:
   member=archive.getmember('app/node_modules/.bin/pkg');self.assertTrue(member.issym());self.assertEqual(member.linkname,'../pkg/index.js')
 def test_explicit_cross_layer_workspace_link(self):
  rows=[file_row(),{'type':'symlink','target':'/app/node_modules/ingenium-core','link':'../packages/ingenium-core'}]
  receipt,body=self.write(rows,external_symlink_targets=('/app/packages/ingenium-core',));self.assertGreater(receipt['entries'],1)
 def test_hash_mismatch_never_returns_receipt(self):
  with self.assertRaisesRegex(m.ArtifactLayerError,'FILE_HASH_OR_SIZE'):self.write([file_row(body=b'changed')])
 def test_growing_file_never_returns_receipt(self):
  with self.assertRaisesRegex(m.ArtifactLayerError,'FILE_HASH_OR_SIZE'):self.write([file_row(body=b'fixtur')])
 def test_short_file_never_returns_receipt(self):
  with self.assertRaises((m.ArtifactLayerError,OSError)):self.write([file_row(body=b'fixture-long')])
 def test_source_close_refusal_never_returns_receipt(self):
  @contextlib.contextmanager
  def source(root,row):
   yield io.BytesIO(b'fixture')
   raise m.ArtifactLayerError('ARTIFACT_SOURCE_READ_CHANGED')
  with patch.object(m,'_source_bytes',source),self.assertRaisesRegex(m.ArtifactLayerError,'SOURCE_READ_CHANGED'):
   m.write_layer(ROOT,[file_row()],io.BytesIO(),source_date_epoch=1700000000)
 def test_output_limit_refused(self):
  with self.assertRaisesRegex(m.ArtifactLayerError,'OUTPUT_BOUND'):self.write(max_compressed_bytes=1)
 def test_partial_output_refused(self):
  class Short(io.BytesIO):
   def write(self,data):return 0
  with self.assertRaisesRegex(m.ArtifactLayerError,'OUTPUT_PARTIAL'):
   m.write_layer(ROOT,[file_row()],Short(),source_date_epoch=1700000000)
 def test_epoch_refused_before_output(self):
  output=io.BytesIO()
  with self.assertRaisesRegex(m.ArtifactLayerError,'EPOCH_INVALID'):m.write_layer(ROOT,[file_row()],output,source_date_epoch=0)
  self.assertEqual(output.getvalue(),b'')
 def test_long_pax_paths_round_trip(self):
  name='node_modules/pkg/'+('long/'*30)+'index.js';receipt,body=self.write([file_row(name)])
  with tarfile.open(fileobj=io.BytesIO(gzip.decompress(body)))as archive:
   self.assertEqual(archive.extractfile('app/'+name).read(),b'fixture')
if __name__=='__main__':unittest.main()
