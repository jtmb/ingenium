import * as fs from "node:fs";
import {isAbsolute,resolve,dirname,join} from "node:path";
import {createHash} from "node:crypto";

const evidence=JSON.parse(fs.readFileSync(new URL("./veyra-projects-native-baseline.json",import.meta.url),"utf8"));
const realIo={lstat:fs.lstatSync,realpath:fs.realpathSync.native,read:fs.readFileSync};
function fail(code,detail) {const error=new Error("VEYRA_PROJECTS_NATIVE_SOURCE_ROOT: "+detail);error.code=code;throw error;}
function directory(path,io) {
  const stat=io.lstat(path);
  if(stat.isSymbolicLink() || !stat.isDirectory() || io.realpath(path)!==path)
    fail("NATIVE_SOURCE_NOT_PLAIN","source directory must be real, canonical and free of symlink/junction aliases: "+path);
}
function ancestors(path,io) {
  const parents=[];let current=path;
  for(;;){parents.push(current);const parent=dirname(current);if(parent===current)break;current=parent;}
  for(const parent of parents.reverse())directory(parent,io);
}
function plainFile(root,relative,io) {
  const path=join(root,...relative.split("/"));ancestors(dirname(path),io);
  const stat=io.lstat(path);
  if(stat.isSymbolicLink() || !stat.isFile() || io.realpath(path)!==path)
    fail("NATIVE_SOURCE_NOT_PLAIN","source file must be plain and canonical: "+relative);
  if(stat.size>1024*1024)fail("NATIVE_SOURCE_SIZE_MISMATCH","source file exceeds fixture limit: "+relative);
  return Buffer.from(io.read(path));
}
export function readNativeBaseline(sourceRoot,io=realIo) {
  if(typeof sourceRoot!=="string" || sourceRoot.length===0)
    fail("NATIVE_SOURCE_ROOT_REQUIRED","set the variable explicitly to the authorized native source root; no sibling/default fallback exists");
  if(!isAbsolute(sourceRoot))fail("NATIVE_SOURCE_ROOT_NOT_ABSOLUTE","an absolute source root is required; no fallback exists");
  const root=resolve(sourceRoot);
  try {
    ancestors(root,io);
    const git=io.lstat(join(root,".git"));
    if(git.isSymbolicLink() || (!git.isFile() && !git.isDirectory()))
      fail("NATIVE_SOURCE_NOT_PLAIN","expected a plain Git source-root marker");
    const cargo=plainFile(root,"Cargo.toml",io).toString("utf8");
    const adapters=plainFile(root,"crates/adapters/Cargo.toml",io).toString("utf8");
    const contracts=plainFile(root,"crates/contracts/Cargo.toml",io).toString("utf8");
    if(!cargo.includes("[workspace]") || !cargo.includes('"crates/adapters"') ||
      !adapters.includes('name = "veyra-adapters"') || !contracts.includes('name = "veyra-contracts"'))
      fail("NATIVE_SOURCE_IDENTITY_MISMATCH","root is not the expected Veyra native source workspace");
    const expectedPaths=Array.from({length:5},(_,i)=>"crates/adapters/src/projects/000"+(i+1)+".sql");
    if(evidence.baseCommit!=="61c99f8e649da85b600fccec93236b5d6b07f78b" ||
      JSON.stringify(evidence.files.map(file=>file.path))!==JSON.stringify(expectedPaths))
      fail("NATIVE_BASE_EVIDENCE_INVALID","expected unchanged v1-v5 base evidence");
    const migrations=evidence.files.map(file=>{
      const bytes=plainFile(root,file.path,io);
      const sha256=createHash("sha256").update(bytes).digest("hex");
      const blob=createHash("sha1").update("blob "+bytes.length+"\0").update(bytes).digest("hex");
      if(bytes.length!==file.bytes || sha256!==file.sha256 || blob!==file.gitBlob)
        fail("NATIVE_SQL_BASE_MISMATCH","unchanged baseline SQL bytes required for "+file.path+
          " at base "+evidence.baseCommit+"; no normalization or alternate checkout fallback");
      return {path:file.path,sha256,gitBlob:blob,sql:bytes.toString("utf8")};
    });
    return {root,baseCommit:evidence.baseCommit,migrations};
  } catch(error) {
    if(error?.code?.startsWith("NATIVE_"))throw error;
    fail("NATIVE_SOURCE_UNREADABLE","explicit source root cannot be validated ("+(error?.code??"read failure")+"); no fallback attempted");
  }
}
export function readConfiguredNativeBaseline() {
  return readNativeBaseline(process.env.VEYRA_PROJECTS_NATIVE_SOURCE_ROOT);
}
