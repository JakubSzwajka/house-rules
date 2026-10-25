import { parseSync } from "@swc/core";

export function withoutEffectRuntimeTesting(path, source, runtimeName) {
  if (!/\.(?:[cm]?js|tsx?)$/u.test(path)) return source;
  let ast;
  try {
    ast = parseSync(source, { syntax: "typescript", tsx: path.endsWith(".tsx") });
  } catch {
    return source;
  }
  const identity = (node) => `${node.value}:${node.ctxt}`;
  const namespaces = new Set();
  const runtimes = new Set();
  const spans = [];
  for (const statement of ast.body) {
    if (
      statement.type !== "ImportDeclaration" ||
      statement.source.value !== "@effect/platform-node"
    )
      continue;
    for (const specifier of statement.specifiers) {
      if (specifier.type === "ImportNamespaceSpecifier") namespaces.add(identity(specifier.local));
      if (
        specifier.type === "ImportSpecifier" &&
        (specifier.imported ?? specifier.local).value === runtimeName
      ) {
        runtimes.add(identity(specifier.local));
        spans.push((specifier.imported ?? specifier.local).span);
      }
    }
  }
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (node.type === "Identifier" && runtimes.has(identity(node))) spans.push(node.span);
    if (
      node.type === "MemberExpression" &&
      node.object.type === "Identifier" &&
      namespaces.has(identity(node.object)) &&
      node.property.type === "Identifier" &&
      node.property.value === runtimeName
    )
      spans.push(node.property.span);
    for (const child of Object.values(node)) {
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child === "object") visit(child);
    }
  };
  visit(ast);
  // SWC spans count UTF-8 bytes, not JavaScript string positions.
  const bytes = Buffer.from(source);
  for (const span of spans) bytes.fill(32, span.start - 1, span.end - 1);
  return bytes.toString();
}
