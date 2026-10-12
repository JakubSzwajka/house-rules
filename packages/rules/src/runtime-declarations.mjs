// Which top-level TypeScript and JavaScript declarations leave a runtime value in the compiled file.

const DECLARATION_TYPES = new Set([
  "VariableDeclaration",
  "FunctionDeclaration",
  "ClassDeclaration",
  "TSEnumDeclaration",
  "TSModuleDeclaration",
  "TSInterfaceDeclaration",
  "TSTypeAliasDeclaration",
  "TSDeclareFunction",
]);

export function isDeclaration(node) {
  return DECLARATION_TYPES.has(node.type);
}

function patternNames(pattern) {
  switch (pattern?.type) {
    case "Identifier":
      return [pattern.name];
    case "ObjectPattern":
      return pattern.properties.flatMap((property) =>
        patternNames(property.type === "RestElement" ? property.argument : property.value),
      );
    case "ArrayPattern":
      return pattern.elements.flatMap((element) => patternNames(element));
    case "AssignmentPattern":
      return patternNames(pattern.left);
    case "RestElement":
      return patternNames(pattern.argument);
    default:
      return [];
  }
}

export function declaredNames(declaration) {
  if (declaration.type === "VariableDeclaration") {
    return declaration.declarations.flatMap((declarator) => patternNames(declarator.id));
  }
  let id = declaration.id;
  // `namespace A.B {}` binds A.
  while (id?.type === "TSQualifiedName") id = id.left;
  return id?.type === "Identifier" ? [id.name] : [];
}

// TypeScript's module instance state: a namespace emits a value unless its body holds only
// types, non-exported import aliases, and namespaces that emit none. A const enum counts as a
// value, as under isolatedModules.
function namespaceBodyEmitsValue(declaration) {
  const { body } = declaration;
  if (!body) return true;
  if (body.type === "TSModuleDeclaration") return namespaceBodyEmitsValue(body);
  return body.body.some((statement) => {
    const exported = statement.type === "ExportNamedDeclaration";
    const inner = exported && statement.declaration ? statement.declaration : statement;
    switch (inner.type) {
      case "TSInterfaceDeclaration":
      case "TSTypeAliasDeclaration":
        return false;
      case "TSImportEqualsDeclaration":
        return exported;
      case "TSModuleDeclaration":
        return namespaceBodyEmitsValue(inner);
      default:
        return true;
    }
  });
}

// Whether a top-level declaration leaves a runtime value in the compiled file.
export function emitsValue(declaration) {
  if (declaration.declare === true) return false;
  switch (declaration.type) {
    case "TSTypeAliasDeclaration":
    case "TSInterfaceDeclaration":
    case "TSDeclareFunction":
      return false;
    case "TSModuleDeclaration":
      return (
        declaration.kind !== "global" &&
        declaration.id.type !== "Literal" &&
        namespaceBodyEmitsValue(declaration)
      );
    default:
      return true;
  }
}
