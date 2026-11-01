from pathlib import Path
import copy,hashlib,importlib.util,json,unittest
_spec=importlib.util.spec_from_file_location('projection',Path(__file__).resolve().parents[1]/'ops/registry_artifact_projection.py')
m=importlib.util.module_from_spec(_spec);_spec.loader.exec_module(m)
D='sha256:'+'1'*64
F='sha256:'+'2'*64
H=hashlib.sha256(b'x').hexdigest()
def row(path,kind='directory',**kwargs):
 value={'path':path,'type':kind,'mode':0o755,'uid':0,'gid':0,'bytes':0}
 if kind=='file':value.update(bytes=1,sha256=H)
 value.update(kwargs);return value
def fixture(extra=()):
 rows=[row('/opt'),row('/opt/app'),row('/opt/app/bin'),row('/opt/app/bin/run','file')]
 values=[rows,*extra]
 meta={'manifest':{'layers':[{'digest':D,'size':10}for _ in values]},'config':{'rootfs':{'diff_ids':[F for _ in values]}}}
 layers=[{'sourceLayerIndex':n,'version':1,'verifiedCompressedAndUncompressedBytes':True,'filesExtractedOrImageAccepted':False,'compressedDigest':D,'compressedBytes':10,'diffId':F,'entries':len(r),'rows':r}for n,r in enumerate(values)]
 return meta,layers
class ProjectionTests(unittest.TestCase):
 def run_tree(self,meta,layers):return m.project_artifact_tree(meta,layers,'/opt/app',required_executable='bin/run')
 def refuses(self,meta,layers,code):
  with self.assertRaisesRegex(m.ArtifactProjectionError,code):self.run_tree(meta,layers)
 def test_complete_tree_digest(self):
  meta,layers=fixture();value=self.run_tree(meta,layers)
  rows=sorted(layers[0]['rows'][1:],key=lambda r:r['path'])
  expected=hashlib.sha256(json.dumps({'version':1,'entries':rows},sort_keys=True,separators=(',',':'),ensure_ascii=True).encode()).hexdigest()
  self.assertEqual(value['sha256'],expected);self.assertEqual(value['regularFiles'],1);self.assertFalse(value['runtimeOrImageReuseAccepted'])
 def test_missing_layer(self):
  meta,layers=fixture([[]]);self.refuses(meta,layers[:1],'LAYER_CLOSURE')
 def test_duplicate_layer(self):
  meta,layers=fixture([[]]);layers[1]['sourceLayerIndex']=0;self.refuses(meta,layers,'LAYER_INDEX')
 def test_wrong_compressed_digest(self):
  meta,layers=fixture();layers[0]['compressedDigest']=F;self.refuses(meta,layers,'LAYER_BINDING')
 def test_wrong_diff(self):
  meta,layers=fixture();layers[0]['diffId']=D;self.refuses(meta,layers,'LAYER_BINDING')
 def test_unverified_data(self):
  meta,layers=fixture();layers[0]['verifiedCompressedAndUncompressedBytes']=False;self.refuses(meta,layers,'LAYER_BINDING')
 def test_deletion_whiteout(self):
  meta,layers=fixture([[row('/opt/app/bin/.wh.run','whiteout')]]);self.refuses(meta,layers,'TREE_EMPTY')
 def test_whiteout_does_not_hide_same_layer_replacement(self):
  meta,layers=fixture([[row('/opt/app/bin/.wh.run','whiteout'),row('/opt/app/bin/run','file',sha256='a'*64)]])
  self.assertNotEqual(self.run_tree(meta,layers)['sha256'],self.run_tree(*fixture())['sha256'])
 def test_opaque_ancestor_hides_tree(self):
  meta,layers=fixture([[row('/opt/.wh..wh..opq','whiteout')]]);self.refuses(meta,layers,'ROOT_MISSING')
 def test_opaque_child_hides_lower_files(self):
  meta,layers=fixture([[row('/opt/app/bin/.wh..wh..opq','whiteout')]]);self.refuses(meta,layers,'TREE_EMPTY')
 def test_parent_replaced_by_file(self):
  meta,layers=fixture([[row('/opt/app/bin','file')]]);self.refuses(meta,layers,'EXECUTABLE_MISSING')
 def test_parent_alias_refused(self):
  meta,layers=fixture([[row('/opt','symlink',link='/else',resolvedImagePath='/else')]]);self.refuses(meta,layers,'LINK_ESCAPE|ANCESTOR_NOT_DIRECTORY')
 def test_extended_metadata_not_discarded(self):
  meta,layers=fixture();layers[0]['rows'][-1]['paxHeadersSha256']=H;self.refuses(meta,layers,'METADATA_UNSUPPORTED')
 def test_hardlink_not_guessed(self):
  meta,layers=fixture();layers[0]['rows'][-1].update(type='hardlink',bytes=0);self.refuses(meta,layers,'METADATA_UNSUPPORTED')
 def test_external_symlink_refused(self):
  meta,layers=fixture([[row('/opt/app/alias','symlink',link='../../etc/passwd',resolvedImagePath='/etc/passwd')]]);self.refuses(meta,layers,'LINK_ESCAPE')
 def test_internal_symlink_to_file(self):
  meta,layers=fixture([[row('/opt/app/alias','symlink',mode=0o777,link='bin/run',resolvedImagePath='/opt/app/bin/run')]])
  self.assertEqual(self.run_tree(meta,layers)['entries'],4)
 def test_dangling_symlink(self):
  meta,layers=fixture([[row('/opt/app/alias','symlink',link='missing',resolvedImagePath='/opt/app/missing')]]);self.refuses(meta,layers,'LINK_MISSING_OR_CYCLE')
 def test_symlink_cycle(self):
  meta,layers=fixture([[row('/opt/app/a','symlink',link='b',resolvedImagePath='/opt/app/b'),row('/opt/app/b','symlink',link='a',resolvedImagePath='/opt/app/a')]]);self.refuses(meta,layers,'LINK_MISSING_OR_CYCLE')
 def test_mutable_parent_refused(self):
  meta,layers=fixture();layers[0]['rows'][0]['mode']=0o777;self.refuses(meta,layers,'MUTABLE_OWNER_OR_MODE')
 def test_mutable_file_refused(self):
  meta,layers=fixture();layers[0]['rows'][-1]['uid']=1000;self.refuses(meta,layers,'MUTABLE_OWNER_OR_MODE')
 def test_missing_parent_refused(self):
  meta,layers=fixture();layers[0]['rows'].pop(2);layers[0]['entries']-=1;self.refuses(meta,layers,'PARENT_MISSING')
 def test_missing_executable_refused(self):
  meta,layers=fixture();layers[0]['rows'][-1]['mode']=0o444;self.refuses(meta,layers,'EXECUTABLE_MISSING')
 def test_duplicate_rows_refused(self):
  meta,layers=fixture();layers[0]['rows'].append(row('/opt'));layers[0]['entries']+=1;self.refuses(meta,layers,'ROW_DUPLICATE')
 def test_traversal_refused(self):
  meta,layers=fixture();layers[0]['rows'][-1]['path']='/opt/app/bin/../run';self.refuses(meta,layers,'PATH_NONCANONICAL')
 def test_later_unrelated_layer_does_not_change_tree(self):
  meta,layers=fixture([[row('/elsewhere'),row('/elsewhere/data','file')]])
  self.assertEqual(self.run_tree(meta,layers)['sha256'],self.run_tree(*fixture())['sha256'])
if __name__=='__main__':unittest.main()
