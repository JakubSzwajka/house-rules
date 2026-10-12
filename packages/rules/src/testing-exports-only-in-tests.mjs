import path from "node:path";
import { importOf, staticPropertyName, unwrapExpression } from "./import-bindings.mjs";
import { ruleDocsUrl } from "./rule-docs.mjs";
import { declaredNames, emitsValue, isDeclaration } from "./runtime-declarations.mjs";

const TESTING_NAME = /Testing$/u;
// The same test paths the migrations bin and the capability preset's test globs name.
const TEST_PATH = /(?:^|\/)(?:tests?|__tests__)\/|\.(?:test|spec)\.[^/]+$/u;
const PATH_SPECIFIER = /^(?:\.{1,2}(?:\/|$)|\/)/u;
const MAX_ALIAS_HOPS = 8;

function nameOf(node) {
  return node.name ?? node.value;
}

function relativeFilename(context) {
  const filename = context.physicalFilename ?? context.filename;
  const relative = path.isAbsolute(filename) ? path.relative(context.cwd, filename) : filename;
  return relative.split(path.sep).join("/");
}

// Testing code: every runtime export is named *Testing, and one of them is a value the file declares.
function isTestingOnlyFile(program) {
  const imported = new Set();
  const localValues = new Set();
  const localTypes = new Set();
  for (const statement of program.body) {
    if (statement.type === "ImportDeclaration") {
      for (const specifier of statement.specifiers) imported.add(specifier.local.name);
      continue;
    }
    const declaration =
      statement.type === "ExportNamedDeclaration" ? statement.declaration : statement;
    if (!declaration) continue;
    if (declaration.type === "TSImportEqualsDeclaration") {
      imported.add(declaration.id.name);
      continue;
    }
    if (!isDeclaration(declaration)) continue;
    const target = emitsValue(declaration) ? localValues : localTypes;
    for (const name of declaredNames(declaration)) target.add(name);
  }
  let ownTestingValue = false;
  for (const statement of program.body) {
    switch (statement.type) {
      case "ExportDefaultDeclaration":
      case "TSExportAssignment":
        return false;
      case "ExportAllDeclaration":
        if (statement.exportKind !== "type") return false;
        break;
      case "ExportNamedDeclaration": {
        if (statement.exportKind === "type") break;
        if (statement.declaration?.type === "TSImportEqualsDeclaration") {
          // `export import x = Db.y` passes a value on; it is not one the file declares.
          if (statement.declaration.importKind === "type") break;
          if (!TESTING_NAME.test(statement.declaration.id.name)) return false;
          break;
        }
        if (statement.declaration) {
          if (!emitsValue(statement.declaration)) break;
          const names = declaredNames(statement.declaration);
          if (names.length === 0 || !names.every((name) => TESTING_NAME.test(name))) return false;
          ownTestingValue = true;
          break;
        }
        for (const specifier of statement.specifiers) {
          if (specifier.exportKind === "type") continue;
          const local = nameOf(specifier.local);
          // A local name declared only as types is erased with its export.
          const ownName = !statement.source && !imported.has(local);
          if (ownName && localTypes.has(local) && !localValues.has(local)) continue;
          if (!TESTING_NAME.test(nameOf(specifier.exported))) return false;
          if (ownName) ownTestingValue = true;
        }
        break;
      }
      default:
        break;
    }
  }
  return ownTestingValue;
}

function findVariable(identifier, sourceCode) {
  let scope = sourceCode.getScope(identifier);
  while (scope) {
    const variable = scope.set.get(identifier.name);
    if (variable) return variable;
    scope = scope.upper;
  }
  return null;
}

function isLiteralSpecifier(node) {
  return (
    (node?.type === "Literal" && typeof node.value === "string") ||
    (node?.type === "TemplateLiteral" && node.expressions.length === 0)
  );
}

// `import * as Db`, `await import("x")`, an unshadowed `require("x")`, or a `const` alias of one.
function isModuleObject(node, sourceCode, hops = 0) {
  const expression = unwrapExpression(node);
  if (!expression || hops > MAX_ALIAS_HOPS) return false;
  if (expression.type === "AwaitExpression") {
    const awaited = unwrapExpression(expression.argument);
    return awaited?.type === "ImportExpression" && isLiteralSpecifier(awaited.source);
  }
  if (expression.type === "CallExpression") {
    const { callee, arguments: args } = expression;
    if (callee.type !== "Identifier" || callee.name !== "require") return false;
    if (args.length !== 1 || !isLiteralSpecifier(args[0])) return false;
    const variable = findVariable(callee, sourceCode);
    return !variable || variable.defs.length === 0;
  }
  if (expression.type !== "Identifier") return false;
  const binding = importOf(expression, sourceCode);
  if (binding) return binding.imported === "*";
  const definition = findVariable(expression, sourceCode)?.defs[0];
  // `import Db = require("@acme/db")`, or `import alias = Db`.
  if (definition?.node.type === "TSImportEqualsDeclaration") {
    const { importKind, moduleReference } = definition.node;
    if (importKind === "type") return false;
    if (moduleReference.type === "TSExternalModuleReference") {
      return isLiteralSpecifier(moduleReference.expression);
    }
    return isModuleObject(moduleReference, sourceCode, hops + 1);
  }
  if (definition?.type !== "Variable" || definition.parent.kind !== "const") return false;
  const declarator = definition.node;
  return (
    declarator.id.type === "Identifier" &&
    declarator.init != null &&
    isModuleObject(declarator.init, sourceCode, hops + 1)
  );
}

function patternKeyName(property) {
  if (property.type !== "Property") return undefined;
  const { key } = property;
  if (key.type === "Literal") return typeof key.value === "string" ? key.value : undefined;
  return property.computed ? undefined : key.name;
}

export const testingExportsOnlyInTestsRule = {
  meta: {
    type: "problem",
    docs: {
      url: ruleDocsUrl("testing-exports-only-in-tests"),
      description:
        "Forbid using a package's testing export, a name that ends in Testing, outside test files and outside testing code whose runtime exports are all named Testing.",
    },
    messages: {
      testingExport:
        "{{name}} is a testing export. Import it only in a test file (under tests/, test/ or __tests__/, or named *.test.* or *.spec.*), or in testing code whose runtime exports are all named *Testing.",
      renamedTestingExport:
        "{{name}} is a testing export re-exported as {{exported}}. Keep a name that ends in Testing, so whoever imports it is checked.",
    },
    schema: [],
  },

  create(context) {
    const { sourceCode } = context;
    if (TEST_PATH.test(relativeFilename(context))) return {};
    if (isTestingOnlyFile(sourceCode.ast)) return {};

    const report = (node, name) =>
      context.report({ node, messageId: "testingExport", data: { name } });
    const reportPattern = (pattern, init) => {
      if (pattern.type !== "ObjectPattern" || !isModuleObject(init, sourceCode)) return;
      for (const property of pattern.properties) {
        const name = patternKeyName(property);
        if (typeof name === "string" && TESTING_NAME.test(name)) report(property, name);
      }
    };

    return {
      ImportSpecifier(node) {
        if (node.parent.importKind === "type" || node.importKind === "type") return;
        const name = nameOf(node.imported);
        if (TESTING_NAME.test(name)) report(node, name);
      },
      // A package index publishes its own testing export by path, under a *Testing name.
      ExportSpecifier(node) {
        const declaration = node.parent;
        if (!declaration.source) return;
        if (declaration.exportKind === "type" || node.exportKind === "type") return;
        const name = nameOf(node.local);
        if (!TESTING_NAME.test(name)) return;
        if (!PATH_SPECIFIER.test(declaration.source.value)) {
          report(node, name);
          return;
        }
        const exported = nameOf(node.exported);
        if (!TESTING_NAME.test(exported)) {
          context.report({ node, messageId: "renamedTestingExport", data: { name, exported } });
        }
      },
      MemberExpression(node) {
        const name = staticPropertyName(node);
        if (
          name !== undefined &&
          TESTING_NAME.test(name) &&
          isModuleObject(node.object, sourceCode)
        ) {
          report(node, name);
        }
      },
      // `import live = Db.DbTesting`, exported or not, reads the export like `Db.DbTesting`.
      TSImportEqualsDeclaration(node) {
        if (node.importKind === "type") return;
        let reference = node.moduleReference;
        if (reference.type !== "TSQualifiedName") return;
        while (reference.left.type === "TSQualifiedName") reference = reference.left;
        const name = reference.right.name;
        if (TESTING_NAME.test(name) && isModuleObject(reference.left, sourceCode)) {
          report(reference, name);
        }
      },
      VariableDeclarator(node) {
        if (node.init) reportPattern(node.id, node.init);
      },
      AssignmentExpression(node) {
        if (node.operator === "=") reportPattern(node.left, node.right);
      },
    };
  },
};
