import { matchesAnyGlob } from "./file-globs.mjs";
import { importOf, staticPropertyName, unwrapExpression } from "./import-bindings.mjs";
import { ruleDocsUrl } from "./rule-docs.mjs";

const CAPABILITY_MODULE = "@house-rules/capability";
const DEFAULT_INCLUDE = ["apps/*/src/use-cases/**/*.{ts,tsx,mts,cts}"];
const DEFAULT_EXCLUDE = ["**/tests/**", "**/*.{test,spec}.{ts,tsx,mts,cts}"];

function capabilityCall(init, sourceCode) {
  const call = unwrapExpression(init);
  if (call?.type !== "CallExpression") return null;
  const callee = unwrapExpression(call.callee);
  if (callee.type === "Identifier") {
    const binding = importOf(callee, sourceCode);
    return binding?.source === CAPABILITY_MODULE ? binding.imported : null;
  }
  const method = staticPropertyName(callee);
  const namespace = callee.type === "MemberExpression" ? importOf(callee.object, sourceCode) : null;
  return namespace?.source === CAPABILITY_MODULE && namespace.imported === "*" ? method : null;
}

function kindOf(declaration, declarator, sourceCode) {
  if (declaration.kind !== "const" || declarator.id.type !== "Identifier") return "other";
  const call = capabilityCall(declarator.init, sourceCode);
  if (call === "implement") return "capability";
  if (call === "defineContract") return "contract";
  return "other";
}

function isTypeOnlyDeclaration(node) {
  return (
    node.type === "TSInterfaceDeclaration" ||
    node.type === "TSTypeAliasDeclaration" ||
    node.declare === true
  );
}

function declaredName(node) {
  return node.id?.name ?? "default";
}

export const useCaseIsCapabilityRule = {
  meta: {
    type: "problem",
    docs: {
      url: ruleDocsUrl("use-case-is-capability"),
      description:
        "Require every use-case file to export exactly one capability built with implement from @house-rules/capability, at most one contract, and no other values.",
    },
    messages: {
      missingCapability:
        "A use-case file exports exactly one capability, `export const <name> = implement(contract, handler)`, with implement imported from @house-rules/capability. This file exports none.",
      extraCapability:
        "A use-case file exports exactly one capability. Move `{{name}}` to its own use-case file.",
      extraContract:
        "A use-case file exports at most one contract, the one its capability implements. Move `{{name}}` to its own use-case file.",
      otherExport:
        "A use-case file exports only its capability, its contract, and types. Keep `{{name}}` unexported, or move it into a package.",
    },
    schema: [
      {
        type: "object",
        properties: {
          include: { type: "array", items: { type: "string", minLength: 1 }, uniqueItems: true },
          exclude: { type: "array", items: { type: "string", minLength: 1 }, uniqueItems: true },
        },
        additionalProperties: false,
      },
    ],
    defaultOptions: [{ include: DEFAULT_INCLUDE, exclude: DEFAULT_EXCLUDE }],
  },

  create(context) {
    const filename = context.physicalFilename ?? context.filename;
    const [{ include, exclude }] = context.options;
    if (!matchesAnyGlob(filename, context.cwd, include)) return {};
    if (matchesAnyGlob(filename, context.cwd, exclude)) return {};
    const { sourceCode } = context;

    return {
      Program(program) {
        const topLevelConsts = new Map();
        for (const statement of program.body) {
          const declaration =
            statement.type === "ExportNamedDeclaration" ? statement.declaration : statement;
          if (declaration?.type !== "VariableDeclaration") continue;
          for (const declarator of declaration.declarations) {
            if (declarator.id.type !== "Identifier") continue;
            topLevelConsts.set(declarator.id.name, kindOf(declaration, declarator, sourceCode));
          }
        }

        const capabilities = [];
        const contracts = [];
        const count = (kind, name, node) => {
          if (kind === "capability") capabilities.push({ name, node });
          else if (kind === "contract") contracts.push({ name, node });
          else context.report({ node, messageId: "otherExport", data: { name } });
        };

        for (const statement of program.body) {
          if (statement.type === "ExportNamedDeclaration") {
            if (statement.exportKind === "type") continue;
            const { declaration } = statement;
            if (declaration?.type === "VariableDeclaration") {
              for (const declarator of declaration.declarations) {
                const name = declarator.id.type === "Identifier" ? declarator.id.name : "binding";
                count(kindOf(declaration, declarator, sourceCode), name, declarator);
              }
            } else if (declaration) {
              if (!isTypeOnlyDeclaration(declaration)) {
                count("other", declaredName(declaration), declaration);
              }
            } else {
              for (const specifier of statement.specifiers) {
                if (specifier.exportKind === "type") continue;
                const local = specifier.local.name ?? specifier.local.value;
                const exported = specifier.exported.name ?? specifier.exported.value;
                const kind = statement.source ? "other" : (topLevelConsts.get(local) ?? "other");
                count(kind, exported, specifier);
              }
            }
          } else if (statement.type === "ExportDefaultDeclaration") {
            if (!isTypeOnlyDeclaration(statement.declaration)) count("other", "default", statement);
          } else if (statement.type === "ExportAllDeclaration") {
            if (statement.exportKind !== "type") {
              count("other", `* from "${statement.source.value}"`, statement);
            }
          } else if (statement.type === "TSExportAssignment") {
            count("other", "export =", statement);
          }
        }

        if (capabilities.length === 0) {
          context.report({
            node: program,
            loc: { line: 1, column: 0 },
            messageId: "missingCapability",
          });
        }
        for (const extra of capabilities.slice(1)) {
          context.report({
            node: extra.node,
            messageId: "extraCapability",
            data: { name: extra.name },
          });
        }
        for (const extra of contracts.slice(1)) {
          context.report({
            node: extra.node,
            messageId: "extraContract",
            data: { name: extra.name },
          });
        }
      },
    };
  },
};
