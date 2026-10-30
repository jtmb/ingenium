import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {stripTypeScriptTypes} from "node:module";
const source=readFileSync(new URL("./core126-manager-auth.proposal.ts",import.meta.url),"utf8").replace(/^import .*;\n/m,"").replace("export function","function");
function fixture(){const state={path:"/original/manager-token",token:"m".repeat(43),uid:1000,mode:0o100600,symlink:false,file:true,real:"/original/manager-token",gets:0};const process={env:{INGENIUM_RUNTIME_MANAGER_TOKEN_FILE:state.path,API_TOKEN:"forbidden fallback"},getuid:()=>1000};const load=new Function("process","lstatSync","readFileSync","realpathSync",stripTypeScriptTypes(source,{mode:"strip"})+"\nreturn loadManagerToken;")(process,()=>({isFile:()=>state.file,isSymbolicLink:()=>state.symlink,uid:state.uid,mode:state.mode}),()=>{state.gets++;return state.token;},()=>state.real);return {state,process,load};}
test("original manager enrollment accepts only its original private owner/mode/file with no mutation",()=>{const f=fixture();assert.equal(f.load(),f.state.token);assert.equal(f.state.gets,1);f.state.token="n".repeat(43);assert.equal(f.load(),f.state.token);});
test("unsafe owner/mode/symlink/canonical path and missing configuration never use API_TOKEN",()=>{for(const mutate of [f=>f.state.uid=2000,f=>f.state.mode=0o100644,f=>f.state.symlink=true,f=>f.state.file=false,f=>f.state.real="/elsewhere",f=>f.state.token="invalid",f=>delete f.process.env.INGENIUM_RUNTIME_MANAGER_TOKEN_FILE]){const f=fixture();mutate(f);assert.throws(f.load);}});
