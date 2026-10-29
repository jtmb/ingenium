import test from "node:test";
import assert from "node:assert/strict";
import {immutableInput} from "../lib/projects-v2/immutable-input.mjs";

test("immutable JSON input is detached and recursively frozen",()=>{
  const input={scope:{owner:"alice"},args:["original",null,true,17]};
  const snapshot=immutableInput(input);
  input.scope.owner="bob";input.args[0]="changed";
  assert.equal(snapshot.scope.owner,"alice");
  assert.equal(snapshot.args[0],"original");
  assert.throws(()=>{snapshot.scope.owner="other";},TypeError);
});
test("non-JSON values and cyclic requests are rejected before admission",()=>{
  const cyclic={};cyclic.self=cyclic;
  for(const input of [cyclic,{action:()=>{}},{value:Infinity},{value:new Date()},undefined]) {
    assert.throws(()=>immutableInput(input),error=>error.code==="VALIDATION_ERROR");
  }
});
