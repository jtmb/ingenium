import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import {join,resolve} from "node:path";
import {readNativeBaseline,readConfiguredNativeBaseline} from "./veyra-projects-native-source.mjs";
const io={lstat:fs.lstatSync,realpath:fs.realpathSync.native,read:fs.readFileSync};
const configured=()=>process.env.VEYRA_PROJECTS_NATIVE_SOURCE_ROOT;
test("explicit native source validates unchanged SQL bytes anchored to recorded base blobs",()=>{
  const result=readConfiguredNativeBaseline();
  assert.equal(result.root,resolve(configured()));
  assert.equal(result.baseCommit,"61c99f8e649da85b600fccec93236b5d6b07f78b");
  assert.equal(result.migrations.length,5);
  assert.equal(result.migrations[0].sql.includes("CREATE TABLE projects"),true);
});
test("native fixture refuses missing or relative roots before any source IO",()=>{
  let calls=0;const never={lstat(){calls++;throw Error("unexpected IO");}};
  assert.throws(()=>readNativeBaseline("",never),e=>e.code==="NATIVE_SOURCE_ROOT_REQUIRED");
  assert.throws(()=>readNativeBaseline("../native-projects",never),e=>e.code==="NATIVE_SOURCE_ROOT_NOT_ABSOLUTE");
  assert.equal(calls,0);
});
test("native fixture refuses canonical aliases and symlink SQL instead of following them",()=>{
  const root=resolve(configured());let forbiddenReads=0;
  assert.throws(()=>readNativeBaseline(root,{...io,realpath:path=>path===root?root+"-alias":io.realpath(path)}),
    e=>e.code==="NATIVE_SOURCE_NOT_PLAIN");
  const target=join(root,"crates","adapters","src","projects","0002.sql");
  assert.throws(()=>readNativeBaseline(root,{...io,lstat:path=>path===target?
    {isSymbolicLink:()=>true,isFile:()=>true,size:10}:io.lstat(path),
    read:path=>{if(path===target)forbiddenReads++;return io.read(path);}}),
    e=>e.code==="NATIVE_SOURCE_NOT_PLAIN");
  assert.equal(forbiddenReads,0);
});
test("native fixture refuses another source identity before reading migration SQL",()=>{
  const root=resolve(configured());let sqlReads=0;
  assert.throws(()=>readNativeBaseline(root,{...io,read:path=>{
    if(path.endsWith(".sql"))sqlReads++;
    return path===join(root,"Cargo.toml")?Buffer.from("[workspace]\nmembers = []\n"):io.read(path);
  }}),e=>e.code==="NATIVE_SOURCE_IDENTITY_MISMATCH");
  assert.equal(sqlReads,0);
});
test("even newline-only changes to baseline SQL are refused without normalization/fallback",()=>{
  const root=resolve(configured()),target=join(root,"crates","adapters","src","projects","0003.sql");
  const reads=[];
  assert.throws(()=>readNativeBaseline(root,{...io,read:path=>{
    reads.push(path);const bytes=io.read(path);return path===target?Buffer.concat([bytes,Buffer.from("\n")]):bytes;
  }}),e=>e.code==="NATIVE_SQL_BASE_MISMATCH");
  assert.equal(reads.some(path=>path.endsWith("0004.sql")),false);
});
test("unreadable explicit source fails closed and never probes a sibling checkout",()=>{
  const attempts=[];
  assert.throws(()=>readNativeBaseline(resolve(configured()),{...io,lstat:path=>{
    attempts.push(path);throw Object.assign(new Error("missing"),{code:"ENOENT"});
  }}),e=>e.code==="NATIVE_SOURCE_UNREADABLE");
  assert.equal(attempts.length,1);
});
