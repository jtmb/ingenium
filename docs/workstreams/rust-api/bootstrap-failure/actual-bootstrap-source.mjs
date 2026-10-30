// Read-only AST extraction from CURRENT ACTUAL Core source, never proposal text.
// This helper grants no production authority and is only for the test harness.
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
export function extractActualBootstrap(app){
 const path=app+'/packages/ingenium-core/lib/db.ts',source=readFileSync(path,'utf8');
 const ts=createRequire(app+'/package.json')('typescript');
 const ast=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true);
 if(ast.parseDiagnostics.length)throw Error('ACTUAL_DB_PARSE_FAILED');
 function only(name,predicate){
  const found=ast.statements.filter(predicate);
  if(found.length!==1)throw Error('ACTUAL_DB_DECLARATION_MISSING_OR_AMBIGUOUS: '+name);
  return source.slice(found[0].getStart(ast),found[0].end);
 }
 const method=name=>only(name,n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);
 const variable=name=>only(name,n=>ts.isVariableStatement(n)&&n.declarationList.declarations.length===1&&n.declarationList.declarations[0].name.getText(ast)===name);
 const stateType=only('DbBootstrapState',n=>ts.isTypeAliasDeclaration(n)&&n.name.text==='DbBootstrapState');
 return {ts,path,source,sha256:createHash('sha256').update(source).digest('hex'),db:variable('db'),writeCount:variable('writeCount'),
  custody:[stateType,variable('dbBootstrapState'),variable('dbBootstrapFailure'),method('refuseUnverifiedDatabase'),method('closeRetainedDatabaseOriginal')].join('\n'),
  getDb:method('getDb'),close:method('closeDbForMaintenance'),reset:method('resetDbForTest')};
}
