import path from 'node:path';
import ts from 'typescript';
const packages = ['veyra-projects', 'veyra-memory', 'veyra-automation', 'veyra-voice', 'veyra-operations'];
/** Fixture-only: keep reviewed shared source imports bound to the original repository. */
export function rewriteFrontendDomainImports(text, sourcePath, repositoryRoot) {
  const roots = packages.map(name => path.resolve(repositoryRoot, 'packages', name));
  const syntax = ts.createSourceFile(sourcePath, text, ts.ScriptTarget.Latest, true);
  const edits = [];
  function reference(specifier) {
    if (!specifier || !ts.isStringLiteralLike(specifier) || !specifier.text.startsWith('.')) return;
    const resolved = path.resolve(path.dirname(sourcePath), specifier.text);
    if (!roots.some(root => resolved.startsWith(root + path.sep))) return;
    edits.push({ start: specifier.getStart(syntax), end: specifier.getEnd(), value: JSON.stringify(resolved.split(path.sep).join('/')) });
  }
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) reference(node.moduleSpecifier);
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments.length === 1) reference(node.arguments[0]);
    ts.forEachChild(node, visit);
  }
  visit(syntax);
  for (const edit of edits.sort((a, b) => b.start - a.start)) text = text.slice(0, edit.start) + edit.value + text.slice(edit.end);
  return text;
}