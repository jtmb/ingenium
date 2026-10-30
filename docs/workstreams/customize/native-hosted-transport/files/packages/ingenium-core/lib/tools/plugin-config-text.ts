/** JSONC plugin-list edits. No evaluation, dependency, normalization or unrelated-property rewrite. */
type Span={start:number;end:number};
type Property={key:string;start:number;valueStart:number;valueEnd:number;comma:number|null};
function fail():never{throw new Error('Plugin configuration is malformed or ambiguous');}
const ws=(c:string|undefined)=>c!==undefined&&/\s/.test(c);
function stringEnd(text:string,start:number):number{
 for(let i=start+1;i<text.length;i++){if(text[i]==='\\'){i++;continue;}if(text[i]==='"')return i+1;}return fail();
}
function masks(text:string):{comments:Span[];withoutComments:string;grammar:string}{
 if(Buffer.byteLength(text,'utf8')>4*1024*1024)fail();
 const chars=text.split(''),comments:Span[]=[];
 if(chars[0]==='\uFEFF')chars[0]=' ';
 for(let i=0;i<text.length;i++){
  if(text[i]==='"'){i=stringEnd(text,i)-1;continue;}
  let end=0;
  if(text[i]==='/'&&text[i+1]==='/'){end=i+2;while(end<text.length&&!['\r','\n'].includes(text[end]!))end++;}
  else if(text[i]==='/'&&text[i+1]==='*'){const close=text.indexOf('*/',i+2);if(close<0)fail();end=close+2;}
  if(end){comments.push({start:i,end});for(let j=i;j<end;j++)if(chars[j]!=='\r'&&chars[j]!=='\n')chars[j]=' ';i=end-1;}
 }
 const withoutComments=chars.join('');
 for(let i=0;i<withoutComments.length;i++){
  if(withoutComments[i]==='"'){i=stringEnd(withoutComments,i)-1;continue;}
  if(withoutComments[i]!==',')continue;
  let next=i+1;while(ws(withoutComments[next]))next++;
  if(withoutComments[next]!=='}'&&withoutComments[next]!==']')continue;
  let previous=i-1;while(ws(withoutComments[previous]))previous--;
  if(previous<0||['[','{',',',':'].includes(withoutComments[previous]!))fail();
  chars[i]=' ';
 }
 return {comments,withoutComments,grammar:chars.join('')};
}
function valueEnd(text:string,start:number):number{
 if(text[start]==='"')return stringEnd(text,start);
 if(text[start]==='['||text[start]==='{'){
  let depth=0;
  for(let i=start;i<text.length;i++){
   if(text[i]==='"'){i=stringEnd(text,i)-1;continue;}
   if(text[i]==='['||text[i]==='{')depth++;
   else if(text[i]===']'||text[i]==='}')if(--depth===0)return i+1;
  }return fail();
 }
 let end=start;while(end<text.length&&!ws(text[end])&&![',','}',']'].includes(text[end]!))end++;
 return end>start?end:fail();
}
function properties(text:string):{open:number;rows:Property[]}{
 let i=0;while(ws(text[i]))i++;if(text[i]!=='{')fail();const open=i++,rows:Property[]=[],keys=new Set<string>();
 while(true){
  while(ws(text[i]))i++;if(text[i]==='}')break;if(text[i]!=='"')fail();const start=i,end=stringEnd(text,i),key=JSON.parse(text.slice(i,end));
  if(keys.has(key))fail();keys.add(key);i=end;while(ws(text[i]))i++;if(text[i++]!==':')fail();while(ws(text[i]))i++;
  const from=i,to=valueEnd(text,i);i=to;while(ws(text[i]))i++;
  const comma=text[i]===','?i++:null;rows.push({key,start,valueStart:from,valueEnd:to,comma});if(comma===null&&text[i]!=='}')fail();
 }
 return {open,rows};
}
function parsed(text:string){
 const mask=masks(text);let object:Record<string,unknown>;
 try{object=JSON.parse(mask.grammar);}catch{return fail();}
 if(!object||typeof object!=='object'||Array.isArray(object))fail();
 const root=properties(mask.withoutComments);return {...mask,...root,object};
}
export function parsePluginConfiguration(text:string):Record<string,unknown>{const object=parsed(text).object;for(const key of ['plugins','plugin'])if(Object.hasOwn(object,key)&&!Array.isArray(object[key]))fail();return object;}
function blank(text:string,span:Span,comments:Span[]):string{
 let out='',cursor=0;for(let i=span.start;i<span.end;i++){while(comments[cursor]&&comments[cursor]!.end<=i)cursor++;const c=comments[cursor];out+=c&&c.start<=i&&i<c.end||['\r','\n',' ','\t'].includes(text[i]!)?text[i]:' ';}return out;
}
export function editPluginConfiguration(text:string,relativePath:string,enabled:boolean):string{
 if(!/^(?:\.opencode\/)?plugins\/[A-Za-z0-9_.\/-]+$/.test(relativePath)||relativePath.split('/').some(p=>!p||p==='..'||p==='.'))fail();
 const p=parsed(text),modern=p.rows.find(r=>r.key==='plugins'),legacy=p.rows.find(r=>r.key==='plugin');
 for(const key of ['plugins','plugin'])if(Object.hasOwn(p.object,key)&&!Array.isArray(p.object[key]))fail();
 const entries=[...new Map([...(p.object.plugins as unknown[]??[]),...(p.object.plugin as unknown[]??[])].filter(v=>enabled||v!==relativePath).map(v=>[JSON.stringify(v),v])).values()];
 if(enabled&&!entries.includes(relativePath))entries.push(relativePath);
 if(modern&&!legacy&&JSON.stringify(p.object.plugins)===JSON.stringify(entries))return text;
 const eol=text.includes('\r\n')?'\r\n':'\n';
 const first=p.rows[0],indent=first?(/^[ \t]*/.exec(text.slice(text.lastIndexOf('\n',first.start)+1,first.start))?.[0]||'  '):'  ';
 const array=JSON.stringify(entries,null,2).replace(/\n/g,eol+indent),edits:Array<Span&{text:string}>=[];
 if(modern){
  const retained=p.comments.filter(c=>c.start>=modern.valueStart&&c.end<=modern.valueEnd).map(c=>text.slice(c.start,c.end));
  edits.push({start:modern.valueStart,end:modern.valueEnd,text:array+(retained.length?eol+retained.join(eol)+eol+indent:'')});
 }
 if(legacy){
  edits.push({start:legacy.start,end:legacy.valueEnd,text:blank(text,{start:legacy.start,end:legacy.valueEnd},p.comments)});
  if(legacy.comma!==null)edits.push({start:legacy.comma,end:legacy.comma+1,text:' '});
  else{const previous=p.rows[p.rows.indexOf(legacy)-1];if(previous?.comma!==null&&previous?.comma!==undefined)edits.push({start:previous.comma,end:previous.comma+1,text:' '});}
 }
 if(!modern){const remaining=p.rows.filter(r=>r!==legacy).length;edits.push({start:p.open+1,end:p.open+1,text:eol+indent+'"plugins": '+array+(remaining?',':'')+eol});}
 edits.sort((a,b)=>b.start-a.start);let result=text;
 for(const edit of edits)result=result.slice(0,edit.start)+edit.text+result.slice(edit.end);
 const observed=parsed(result).object;
 if(Object.hasOwn(observed,'plugin')||JSON.stringify(observed.plugins)!==JSON.stringify(entries))fail();
 for(const key of Object.keys(p.object).filter(k=>k!=='plugin'&&k!=='plugins'))if(JSON.stringify(observed[key])!==JSON.stringify(p.object[key]))fail();
 return result;
}