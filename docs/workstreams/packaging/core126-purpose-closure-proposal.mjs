import {createHash} from 'node:crypto';
export const CLOSURE_PREIMAGE='029887a063c945a08202e0075313f9f47b7251e5ae649bbe1bc16f90441a5798';
export const CONTRACT_PREIMAGE='a904467322ad5ddcc0e0d9084b84c303a0d95eccc5511aa0b7539beb10e0fcdb';
export const PURPOSE_PREIMAGE='d865891ca7678458ec9872e5d108cdef31e7a913bf217e806d091b7420fc9bda';
export const HELPER_PREIMAGE='8b170f2ac20d2c151695768d1db1bf10207a6465354393bc51a9a164fe67b1a1';
const sha=b=>createHash('sha256').update(b).digest('hex');
function replaceOne(source,before,after){if(source.split(before).length!==2)throw Error('Exact closure anchor unavailable');return source.replace(before,after);}
function diff(before,after,file){
 const a=before.split('\n'),b=after.split('\n');if(a.at(-1)==='')a.pop();if(b.at(-1)==='')b.pop();
 const dp=Array.from({length:a.length+1},()=>new Uint16Array(b.length+1));for(let i=a.length-1;i>=0;i--)for(let j=b.length-1;j>=0;j--)dp[i][j]=a[i]===b[j]?1+dp[i+1][j+1]:Math.max(dp[i+1][j],dp[i][j+1]);
 const ops=[];let i=0,j=0;while(i<a.length||j<b.length){const old=i,next=j;if(i<a.length&&j<b.length&&a[i]===b[j]){ops.push({kind:' ',text:a[i++],old,next});j++;}else if(i<a.length&&(j===b.length||dp[i+1][j]>=dp[i][j+1]))ops.push({kind:'-',text:a[i++],old,next});else ops.push({kind:'+',text:b[j++],old,next});}
 const groups=[];for(const n of ops.flatMap((op,n)=>op.kind===' '?[]:[n])){const first=Math.max(0,n-3),last=Math.min(ops.length,n+4),group=groups.at(-1);if(group&&first<=group.last)group.last=Math.max(group.last,last);else groups.push({first,last});}
 const rows=[`diff --git a/${file} b/${file}`,`--- a/${file}`,`+++ b/${file}`];const segments=[];for(const group of groups){let first=group.first;for(let n=first;n<=group.last;n++)if(n===group.last||(ops[n].kind===' '&&ops[n].text==='')){if(n>first&&ops.slice(first,n).some(op=>op.kind!==' '))segments.push({first,last:n});first=n+1;}}for(const{first,last}of segments){const h=ops.slice(first,last),old=h.filter(op=>op.kind!=='+').length,next=h.filter(op=>op.kind!=='-').length;rows.push(`@@ -${h[0].old+(old?1:0)},${old} +${h[0].next+(next?1:0)},${next} @@`,...h.map(op=>op.kind+op.text));}return rows.join('\n')+'\n';
}
/** Proposes bytes in memory only. No shared source or distribution is written. */
export function proposePurposeClosure({copyBytes,contractBytes}){
 if(!Buffer.isBuffer(copyBytes)||sha(copyBytes)!==CLOSURE_PREIMAGE||!Buffer.isBuffer(contractBytes)||sha(contractBytes)!==CONTRACT_PREIMAGE)throw Error('Changed original closure/contract preimage');
 const beforeCopy=new TextDecoder('utf-8',{fatal:true}).decode(copyBytes),beforeContract=new TextDecoder('utf-8',{fatal:true}).decode(contractBytes),nl=beforeCopy.includes('\r\n')?'\r\n':'\n';
 let copy=replaceOne(beforeCopy,"const digest = bytes =>",["// Reviewed singleton only: never discover or copy the release-tools directory.","const singletonTools = [{ source: 'tools/veyra-release/core126-candidate-intent.mjs', target: 'veyra-tools/veyra-release/core126-candidate-intent.mjs' }];","const digest = bytes =>"].join(nl));
 const singleton=`  const sourceOwner = fs.statSync(sourceRoot).uid;
  const checkSingleton = stat => {
    if (!stat.isFile() || stat.isSymbolicLink?.() || stat.nlink !== 1 || !Number.isSafeInteger(sourceOwner) || stat.uid !== sourceOwner || !Number.isSafeInteger(stat.size) || stat.size < 1 || stat.size > 65536) throw new Error('Unsafe reviewed runtime singleton');
  };
  const readSingleton = entry => {
    let fd;
    try {
      if (fs.realpathSync(entry.source) !== entry.source) throw new Error('Runtime singleton aliases another source');
      fd = fs.openSync(entry.source, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
      const first = fs.fstatSync(fd); checkSingleton(first);
      const raw = fs.readFileSync(fd), last = fs.fstatSync(fd), current = fs.lstatSync(entry.source);
      checkSingleton(last); checkSingleton(current);
      if (raw.length !== first.size || fs.realpathSync(entry.source) !== entry.source || ['dev','ino','size','mtimeMs','uid','gid','mode','nlink'].some(key => first[key] !== last[key] || first[key] !== current[key])) throw new Error('Runtime singleton changed during read');
      return raw;
    } finally { if (fd !== undefined) fs.closeSync(fd); }
  };
  for (const item of singletonTools) {
    const source = path.join(sourceRoot, ...item.source.split('/'));
    let stat;
    try { stat = fs.lstatSync(source); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    checkSingleton(stat);
    const canonical = fs.realpathSync(source);
    if (canonical !== source || !within(sourceRoot, canonical)) throw new Error('Runtime singleton escaped reviewed source');
    files.set(canonical, { source: canonical, target: path.join(destination, ...item.target.split('/')), singleton: true });
  }
`;
 copy=replaceOne(copy,'  const planned = [];',singleton.split('\n').join(nl)+'  const planned = [];');
 copy=replaceOne(copy,'    const raw = fs.readFileSync(entry.source);','    const raw = entry.singleton ? readSingleton(entry) : fs.readFileSync(entry.source);');
 let contract=replaceOne(beforeContract,"'packages/ingenium-extension/scripts/job-run-mcp-client.ts']);","'packages/ingenium-extension/scripts/job-run-mcp-client.ts','services/ingenium-api/lib/dot-v2/core126-purpose.mjs','tools/veyra-release/core126-candidate-intent.mjs']);");
 contract=replaceOne(contract,"'/app/packages/ingenium-extension/dist/scripts/job-run-mcp-client.js']);","'/app/packages/ingenium-extension/dist/scripts/job-run-mcp-client.js','/app/services/ingenium-api/dist/lib/dot-v2/core126-purpose.mjs','/app/services/ingenium-api/dist/veyra-tools/veyra-release/core126-candidate-intent.mjs']);");
 const files=[{path:'services/ingenium-api/scripts/copy-domain-runtime.mjs',before:copyBytes,after:Buffer.from(copy)},{path:'packages/veyra-operations/core126-image-contract.mjs',before:contractBytes,after:Buffer.from(contract)}];
 return{files:files.map(f=>({...f,beforeSha256:sha(f.before),afterSha256:sha(f.after)})),patch:files.map(f=>diff(f.before.toString('utf8'),f.after.toString('utf8'),f.path)).join('')};
}
