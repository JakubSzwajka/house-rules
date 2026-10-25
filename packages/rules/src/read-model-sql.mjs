import { parseForESLint } from "@typescript-eslint/parser";
import { selectProblems } from "./sql-select.mjs";
import { sqlSettingsProblems } from "./sql-settings.mjs";
import { sqlTokens } from "./sql-tokens.mjs";
import { unwrapExpression } from "./import-bindings.mjs";
import { sourceGraph } from "./source-provenance.mjs";

const walk = (node, work, parent) => {
  if (!node || typeof node !== "object") return;
  if (typeof node.type === "string") work(node, parent);
  for (const [key, value] of Object.entries(node)) {
    if (["parent", "loc", "range", "tokens", "comments"].includes(key)) continue;
    if (Array.isArray(value)) for (const child of value) walk(child, work, node);
    else if (value && typeof value === "object") walk(value, work, node);
  }
};
const sqlModule = (name) => /^(?:effect\/(?:unstable\/)?sql(?:\/|$)|@effect\/sql-)/u.test(name);
const rawApi = /^(?:unsafe|raw|literal|fragment|identifier|query|execute.*)$/iu;
const primitive = (type) =>
  ["TSStringKeyword", "TSNumberKeyword", "TSBooleanKeyword", "TSLiteralType"].includes(type?.type);

export const readModelSqlProblems = (
  source,
  views,
  { filename = "/read-model.ts", cwd = process.cwd(), workspaces = [] } = {},
) => {
  const problems = [];
  let parsed;
  try {
    parsed = parseForESLint(source, { loc: true, range: true, sourceType: "module" });
  } catch {
    return ["cannot read read-model source; SQL must be static SELECT text."];
  }
  const { ast, scopeManager } = parsed;
  const graph = sourceGraph(filename, ast, scopeManager, { cwd, workspaces });
  const references = new Map(
    scopeManager.scopes
      .flatMap((scope) => scope.references)
      .map((ref) => [ref.identifier, ref.resolved]),
  );
  const clients = new Set();
  const clientDeclarations = new Set();
  const namespaces = new Set();
  const sqlTypes = new Set();
  const parameterClients = new Set();
  const yielded = new Set();
  const typeReferences = new Set(
    scopeManager.scopes
      .flatMap((scope) => scope.references)
      .filter((ref) => ref.isTypeReference && !ref.isValueReference)
      .map((ref) => ref.identifier),
  );
  const parents = new Map();
  const acquisitions = new Set();
  const implicitClient = (node) =>
    node?.type === "Identifier" &&
    node.name === "sql" &&
    references.has(node) &&
    !references.get(node);
  const client = (node) =>
    node?.type === "Identifier" && (clients.has(references.get(node)) || implicitClient(node));
  const sqlService = (node) => {
    node = unwrapExpression(node);
    return node?.type === "Identifier"
      ? namespaces.has(references.get(node)) ||
          (!references.get(node) && ["SqlClient", "PgClient"].includes(node.name))
      : node?.type === "MemberExpression" &&
          !node.computed &&
          ["SqlClient", "PgClient"].includes(node.property.name) &&
          sqlService(node.object);
  };
  walk(ast, (node, parent) => {
    parents.set(node, parent);
    if (
      (["ExportNamedDeclaration", "ExportAllDeclaration", "ImportExpression"].includes(node.type) &&
        sqlModule(node.source?.value)) ||
      (node.type === "TSImportEqualsDeclaration" &&
        sqlModule(node.moduleReference.expression?.value)) ||
      (node.type === "CallExpression" &&
        node.callee.name === "require" &&
        sqlModule(node.arguments[0]?.value))
    )
      problems.push("read-model SQL cannot dynamically import or re-export SQL services or APIs.");
    if (node.type !== "ImportDeclaration") return;
    if (
      node.importKind !== "type" &&
      (/\/Statement$/u.test(node.source.value) ||
        node.specifiers.some(
          (spec) => spec.importKind !== "type" && spec.imported?.name === "Statement",
        ))
    )
      problems.push("read-model SQL cannot import Statement or SQL fragment builders.");
    for (const scope of scopeManager.scopes)
      for (const variable of scope.variables)
        if (variable.defs.some((def) => def.parent === node)) {
          const local = variable.defs[0].name;
          const origin = graph.importOrigin(filename, local, sqlModule);
          if (!sqlModule(node.source.value) && !origin) continue;
          sqlTypes.add(variable);
          if (node.importKind !== "type" && variable.defs[0].node.importKind !== "type") {
            const resolved = graph.resolve(filename, local);
            if (
              resolved?.annotation ||
              resolved?.node?.type === "YieldExpression" ||
              origin?.imported === "sql"
            )
              clients.add(variable);
            else namespaces.add(variable);
          }
        }
  });
  walk(ast, (node) => {
    if (node.type !== "VariableDeclarator") return;
    const init = unwrapExpression(node.init);
    if (init?.type !== "YieldExpression") return;
    for (const scope of scopeManager.scopes)
      for (const variable of scope.variables)
        if (variable.defs.some((def) => def.node === node)) {
          yielded.add(variable);
          if (node.id.type === "Identifier" && sqlService(init.argument)) {
            clients.add(variable);
            if (
              variable.defs[0].parent.kind !== "const" ||
              variable.references.some((ref) => ref.isWrite() && !ref.init)
            )
              problems.push("read-model SQL clients require an unmodified const binding.");
          }
        }
    if (node.id.type === "Identifier" && sqlService(init.argument)) {
      clientDeclarations.add(node.id);
      acquisitions.add(init);
    }
  });
  const sqlType = (type, seen = new Set()) => {
    if (!type || seen.has(type)) return false;
    const next = new Set([...seen, type]);
    if ((type.types ?? type.typeArguments?.params ?? []).some((part) => sqlType(part, next)))
      return true;
    if (type.type === "TSImportType") return sqlModule(type.source?.value);
    if (type.type !== "TSTypeReference")
      return sqlType(type.typeAnnotation ?? type.elementType, next);
    let name = type.typeName;
    while (name.type === "TSQualifiedName") name = name.left;
    const variable = references.get(name);
    if (sqlTypes.has(variable)) return true;
    const def = variable?.defs[0];
    return def?.node.type === "TSTypeAliasDeclaration" && sqlType(def.node.typeAnnotation, next);
  };
  for (const scope of scopeManager.scopes)
    for (const variable of scope.variables) {
      const def = variable.defs[0];
      if (def?.type === "Parameter" && sqlType(def.name.typeAnnotation?.typeAnnotation)) {
        clients.add(variable);
        parameterClients.add(variable);
      }
    }
  const domainType = (type, name) => {
    if (type?.type !== "TSTypeReference" || type.typeName.type !== "Identifier") return false;
    const def = references.get(type.typeName)?.defs[0];
    return (
      def?.type === "ImportBinding" &&
      def.node.imported?.name === name &&
      ["@house-rules/domain", "@house-rules/domain/contract"].includes(def.parent.source.value)
    );
  };
  const valueType = (node) => {
    const parts = [];
    while (node?.type === "MemberExpression" && !node.computed) {
      parts.unshift(node.property.name);
      node = node.object;
    }
    if (node?.type !== "Identifier") return undefined;
    const variable = references.get(node);
    if (
      !variable ||
      variable.defs.length !== 1 ||
      variable.references.some((ref) => ref.isWrite() && !ref.init)
    )
      return undefined;
    const def = variable.defs[0];
    if (def.type !== "Parameter") return undefined;
    let type = def.name.typeAnnotation?.typeAnnotation;
    for (const part of parts) {
      if (domainType(type, "Actor") && part === "id") type = { type: "TSStringKeyword" };
      else
        type =
          type?.type === "TSTypeLiteral"
            ? type.members.find(
                (member) => member.type === "TSPropertySignature" && member.key.name === part,
              )?.typeAnnotation?.typeAnnotation
            : undefined;
    }
    return domainType(type, "ActorId") ? { type: "TSStringKeyword" } : type;
  };
  const safeValue = (expression, seen = new Set()) => {
    const node = unwrapExpression(expression);
    if (!node || seen.has(node)) return false;
    if (node.type === "Literal")
      return node.value === null || ["string", "number", "boolean"].includes(typeof node.value);
    if (primitive(valueType(node))) return true;
    if (node.type !== "Identifier") return false;
    const variable = references.get(node);
    const def = variable?.defs[0];
    return (
      variable?.defs.length === 1 &&
      def?.type === "Variable" &&
      def.parent.kind === "const" &&
      safeValue(def.node.init, new Set([...seen, node]))
    );
  };
  walk(ast, (node, parent) => {
    if (node.type === "Identifier" && typeReferences.has(node)) return;
    if (node.type === "Identifier" && client(node) && !clientDeclarations.has(node)) {
      if (parameterClients.has(references.get(node)))
        problems.push(
          "read-model SQL client parameters are unsupported; acquire the SQL service with a direct yield.",
        );
      if (!(parent?.type === "TaggedTemplateExpression" && parent.tag === node))
        problems.push(
          "read-model SQL client may be used only as a direct template tag; aliases, helpers and raw APIs are forbidden.",
        );
    }
    if (
      node.type === "Identifier" &&
      references.has(node) &&
      (namespaces.has(references.get(node)) ||
        (!references.get(node) && ["SqlClient", "PgClient"].includes(node.name)))
    ) {
      let ancestor = node;
      while (parents.get(ancestor)?.type === "MemberExpression") ancestor = parents.get(ancestor);
      if (!acquisitions.has(parents.get(ancestor)))
        problems.push(
          "read-model SQL services may only be acquired by a direct yield; helper and callback query access is forbidden.",
        );
    }
    if (node.type === "MemberExpression") {
      const name = node.computed ? node.property.value : node.property.name;
      if (rawApi.test(name ?? ""))
        problems.push("read-model SQL cannot reference unsafe/raw or connection query APIs.");
    }
    if (
      node.type === "CallExpression" &&
      node.callee.type === "Identifier" &&
      /^(?:sql|query|execute.*|database)$/iu.test(node.callee.name)
    )
      problems.push(
        "read-model SQL must be static tagged SELECT text, not a query string or call.",
      );
    if (node.type !== "TaggedTemplateExpression") return;
    if (!client(node.tag)) {
      if (node.tag.type === "Identifier" && yielded.has(references.get(node.tag)))
        problems.push(
          "read-model SQL tag has an unrecognized acquisition; use a direct imported SQL service yield.",
        );
      return;
    }
    for (const expression of node.quasi.expressions)
      if (!safeValue(expression))
        problems.push(
          "read-model interpolation is allowed only for proven parameter values, never identifiers or SQL fragments.",
        );
    const pieces = node.quasi.quasis.map((part) => part.value.cooked ?? part.value.raw);
    const settings = sqlSettingsProblems([], pieces.join("\u0000"));
    if (settings.length) {
      problems.push(...settings);
      return;
    }
    try {
      const tokens = sqlTokens(pieces.join("\u0000"), { parameters: true, asciiOnly: true });
      if (
        tokens.filter(({ kind }) => kind === "parameter").length !== node.quasi.expressions.length
      )
        problems.push(
          "read-model interpolation must be an unquoted value parameter, never quoted text or a comment.",
        );
      problems.push(...selectProblems(tokens, views).map((problem) => `read-model ${problem}`));
    } catch (error) {
      problems.push(
        `read-model SQL supports only one SELECT in the supported grammar: ${error.message}.`,
      );
    }
  });
  return [...new Set(problems)];
};
