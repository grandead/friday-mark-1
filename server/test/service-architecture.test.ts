import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('../src/', import.meta.url));
const scripts = resolve(root, '../scripts');
const services = join(root, 'services');
const DATABASE_ARTIFACT_DIRECTORIES = new Set([
  join(services, 'database/migrations'),
  join(services, 'database/generated'),
]);
const MODULE_OPTIONS: ts.CompilerOptions = {
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  allowJs: true,
  paths: { '@/*': [`${root}/*`] },
  resolveJsonModule: true,
  jsx: ts.JsxEmit.Preserve,
};
function files(directory: string): string[] {
  if (DATABASE_ARTIFACT_DIRECTORIES.has(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? files(join(directory, entry.name))
      : /\.(?:tsx?|mjs)$/.test(entry.name)
        ? [join(directory, entry.name)]
        : [],
  );
}
function isProductionScript(path: string) {
  return !path.includes('/smoke-');
}
function owner(path: string) {
  const name = relative(services, path).split('/')[0];
  return name === '..' ? undefined : name;
}

// Production modules cross service boundaries through explicit public barrels.
// Unit tests and smoke scripts may construct isolated implementations directly.
test('service imports respect public boundaries and form an acyclic graph', () => {
  const edges = new Map<string, Set<string>>();
  const productionFiles = [...files(root), ...files(scripts).filter(isProductionScript)];
  for (const path of productionFiles) {
    const module = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest);
    const source = owner(path);
    if (source && !edges.has(source)) edges.set(source, new Set());
    function visit(node: ts.Node) {
      if (ts.isExportDeclaration(node)) {
        assert.ok(node.exportClause, `Wildcard export: ${relative(root, path)}`);
      }
      const specifier =
        ts.isImportDeclaration(node) || ts.isExportDeclaration(node)
          ? node.moduleSpecifier
          : ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
            ? node.arguments[0]
            : undefined;
      if (
        specifier &&
        ts.isStringLiteral(specifier) &&
        !specifier.text.endsWith('.css') &&
        (specifier.text.startsWith('.') || specifier.text.startsWith('@/'))
      ) {
        assert.doesNotMatch(specifier.text, /\/index(?:\.[cm]?[jt]sx?)?$/);
        const resolution = ts.resolveModuleName(specifier.text, path, MODULE_OPTIONS, ts.sys);
        const targetPath = resolution.resolvedModule?.resolvedFileName;
        assert.ok(targetPath, `Unresolved project import: ${specifier.text} in ${path}`);
        const target = owner(targetPath);
        if (source) {
          assert.ok(
            !['http', 'api', 'ws', 'app', 'index.ts'].includes(
              relative(root, targetPath).split('/')[0],
            ),
            `Service ${source} must not depend on the HTTP layer`,
          );
        }
        if (target && target !== source) {
          assert.equal(
            targetPath,
            join(services, target, 'index.ts'),
            `${relative(root, path)} must import ${target} through index.ts`,
          );
          if (source) edges.get(source)!.add(target);
        }
        const home = join(services, 'llm-tools/smart-home');
        if (targetPath.startsWith(`${home}/`) && !path.startsWith(`${home}/`)) {
          assert.equal(source, 'llm-tools', 'Only llm-tools may import its smart-home module');
          assert.equal(targetPath, join(home, 'index.ts'));
        }
        const devices = join(services, 'smart-home/devices/');
        const drivers = join(services, 'smart-home/drivers/');
        if (path.startsWith(devices) && targetPath.startsWith(drivers)) {
          const protocol = relative(drivers, targetPath).split('/')[0];
          assert.equal(targetPath, join(drivers, protocol, 'index.ts'));
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(module);
  }
  function walk(name: string, chain: string[]) {
    assert.ok(!chain.includes(name), `Service dependency cycle: ${[...chain, name].join(' -> ')}`);
    for (const dependency of edges.get(name) ?? []) walk(dependency, [...chain, name]);
  }
  for (const service of edges.keys()) walk(service, []);
});

test('handwritten application and script functions follow the nesting conventions', checkNesting);

function checkNesting() {
  const shared = resolve(root, '../shared');
  const registryUi = join(root, 'components/ui/');
  const paths = [...files(root), ...files(shared), ...files(scripts)];
  const violations: string[] = [];
  for (const path of paths) {
    if (path.startsWith(registryUi)) continue;
    const text = readFileSync(path, 'utf8');
    const module = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
    inspectNesting(module, false, false, violations);
  }
  assert.deepEqual(violations, []);
}

function inspectNesting(
  node: ts.Node,
  inFunction: boolean,
  inArgument: boolean,
  violations: string[],
) {
  const isFunction = ts.isFunctionLike(node) && 'body' in node && !!node.body;
  if (isFunction && inFunction && !isSingleLineArrow(node)) {
    recordViolation(node, 'nested function', violations);
  }
  if (inArgument && ts.isCallExpression(node)) {
    recordViolation(node, 'call inside an argument', violations);
  }
  if (inArgument && ts.isPropertyAssignment(node) && isInlineZodField(node)) {
    inspectNesting(node.name, inFunction, true, violations);
    inspectNesting(node.initializer, inFunction, false, violations);
    return;
  }
  if (ts.isCallExpression(node)) {
    inspectNesting(node.expression, inFunction, inArgument, violations);
    for (const argument of node.arguments) inspectNesting(argument, inFunction, true, violations);
    return;
  }
  const inside = inFunction || isFunction;
  const argument = inArgument && !isFunction;
  ts.forEachChild(node, (child) => inspectNesting(child, inside, argument, violations));
}

function isInlineZodField(field: ts.PropertyAssignment) {
  const shape = field.parent;
  const call = shape.parent;
  if (!ts.isCallExpression(call) || call.arguments[0] !== shape) return false;
  if (call.expression.getText() !== 'z.strictObject') return false;

  let builder = field.initializer;
  while (ts.isCallExpression(builder) && ts.isPropertyAccessExpression(builder.expression)) {
    builder = builder.expression.expression;
  }
  return ts.isIdentifier(builder) && builder.text === 'z';
}

function isSingleLineArrow(node: ts.Node) {
  if (!ts.isArrowFunction(node)) return false;
  const source = node.getSourceFile();
  const start = node.getStart();
  const first = source.getLineAndCharacterOfPosition(start);
  const last = source.getLineAndCharacterOfPosition(node.end);
  return first.line === last.line;
}

function recordViolation(node: ts.Node, message: string, violations: string[]) {
  const file = node.getSourceFile();
  const start = node.getStart();
  const position = file.getLineAndCharacterOfPosition(start);
  const path = relative(root, file.fileName);
  violations.push(`${path}:${position.line + 1} ${message}`);
}
