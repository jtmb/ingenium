import {lstatSync,readFileSync,realpathSync} from "node:fs";
/** Exact original runtime-manager file owner, factored for Core's narrow journal enrollment.
 * API_TOKEN, cookies, user/service credentials and caller-supplied token paths are not fallbacks.
 */
export function loadManagerToken():string {
 const path=process.env.INGENIUM_RUNTIME_MANAGER_TOKEN_FILE?.trim();if(!path)throw Error("INGENIUM_RUNTIME_MANAGER_TOKEN_FILE is required");
 const stat=lstatSync(path),uid=typeof process.getuid==="function"?process.getuid():stat.uid;
 if(!stat.isFile()||stat.isSymbolicLink()||stat.uid!==uid||(stat.mode&0o077)!==0||realpathSync(path)!==path)throw Error("Runtime manager token file is unsafe");
 const token=readFileSync(path,"utf8").trim();if(!/^[A-Za-z0-9_-]{43,128}$/.test(token))throw Error("Runtime manager token is invalid");return token;
}
