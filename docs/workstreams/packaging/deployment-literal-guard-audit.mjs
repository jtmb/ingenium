// Interpret simple source-level require/reject_literal commands without evaluating shell.
// Unknown variables, shell operators and substitutions are recorded as unexamined.
import fs from 'node:fs';import path from 'node:path';
export function literalTokens(text,variables={}){
 let i=0,tokens=[];
 while(i<text.length){while(/\s/.test(text[i]??'')&&i<text.length)i++;if(i>=text.length)break;
  let token='',quote=null;
  while(i<text.length){const c=text[i];if(!quote&&/\s/.test(c))break;
   if(c==="'"&&quote!=='"'){quote=quote==="'"?null:"'";i++;continue;}
   if(c==='"'&&quote!=="'"){quote=quote==='"'?null:'"';i++;continue;}
   if(c==='\\'&&quote!=="'"){const next=text[i+1];if(next===undefined)throw Error('Incomplete escape');if(!quote||['$','`','"','\\','\n'].includes(next)){token+=next;i+=2;continue;}token+='\\';i++;continue;}
   if(c==='$'&&quote!=="'"){
    if(text[i+1]==='(')throw Error('Shell substitution is not interpreted');
    const match=/^\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))/.exec(text.slice(i));
    if(!match||!Object.hasOwn(variables,match[1]??match[2]))throw Error('Unresolved shell variable');
    token+=variables[match[1]??match[2]];i+=match[0].length;continue;
   }
   if((c==='`'&&quote!=="'")||(!quote&&/[;|&<>]/.test(c)))throw Error('Shell operation is not interpreted');
   token+=c;i++;
  }
  if(quote)throw Error('Unclosed shell quote');tokens.push(token);
 }
 return tokens;
}
export function checkDeploymentLiteralGuards(root,overrides=new Map()){
 const source=overrides.get('scripts/validate-deployment-config.sh')??fs.readFileSync(path.join(root,'scripts/validate-deployment-config.sh'),'utf8');
 const variables={repo_root:'/REPOSITORY'},checks=[],unexamined=[],failures=[];
 for(const [index,line]of source.replaceAll('\r\n','\n').split('\n').entries()){
  const assignment=/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
  if(assignment&&assignment[1]!=='repo_root'){try{const value=literalTokens(assignment[2],variables);if(value.length===1)variables[assignment[1]]=value[0];}catch{}}
  const command=/^\s*(require_literal|reject_literal)\s+/.exec(line);if(!command)continue;
  let parts;try{parts=literalTokens(line.trim(),variables);}catch(error){unexamined.push({line:index+1,reason:error.message});continue;}
  if(parts.length!==3||!parts[1].startsWith('/REPOSITORY/')){unexamined.push({line:index+1,reason:'Noncanonical literal guard target'});continue;}
  const name=parts[1].slice('/REPOSITORY/'.length);if(name.split('/').includes('..'))throw Error('Unsafe source guard target');
  let actual;try{actual=overrides.get(name)??fs.readFileSync(path.join(root,...name.split('/')),'utf8');}catch(error){failures.push({line:index+1,kind:parts[0],path:name,literal:parts[2],reason:'Source target missing'});continue;}
  const present=actual.includes(parts[2]),ok=parts[0]==='require_literal'?present:!present;
  const entry={line:index+1,kind:parts[0],path:name,literal:parts[2],ok};checks.push(entry);if(!ok)failures.push(entry);
 }
 return{checks,unexamined,failures};
}
