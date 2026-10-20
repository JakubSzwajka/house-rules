import path from "node:path";
import { matchesAnyGlob } from "./file-globs.mjs";
import { importOf, unwrapExpression } from "./import-bindings.mjs";
import { ruleDocsUrl } from "./rule-docs.mjs";
import { relativeSource } from "./source-provenance.mjs";

const callImport = (expression, sourceCode) => {
  const call = unwrapExpression(expression);
  if (call?.type !== "CallExpression") return undefined;
  const callee = unwrapExpression(call.callee);
  if (callee.type === "Identifier") return { ...importOf(callee, sourceCode), call };
  return undefined;
};

export const nodeFileRule = {
  meta: {
    type: "problem",
    docs: {
      url: ruleDocsUrl("node-file"),
      description:
        "Require one direct node.ts descriptor, own-node handler.ts binding and optional own-node entry.ts Entry; allow type exports.",
    },
    schema: [
      {
        type: "object",
        properties: { appsDir: { type: "array", items: { type: "string" } } },
        additionalProperties: false,
      },
    ],
    messages: {
      shape:
        "{{file}} exports exactly one direct {{builder}} value and no other values; import {{builder}} by name from {{door}}.",
      own: "Use the descriptor imported by name from this folder's own node.ts.",
      entryImport: "An entry imports only its own node.ts and @house-rules/application/contract.",
      import:
        "A node descriptor imports only Schema from effect, domain/contract, other node.ts descriptors and contract doors.",
    },
  },
  create(context) {
    const filename = path.resolve(context.physicalFilename ?? context.filename);
    const roots = context.options[0]?.appsDir ?? ["apps"];
    if (
      !matchesAnyGlob(
        filename,
        context.cwd,
        roots.map((root) => `${root}/*/src/features/*/{node,handler,entry}.ts`),
      )
    )
      return {};
    const descriptor = path.basename(filename) === "node.ts";
    const entry = path.basename(filename) === "entry.ts";
    return {
      Program(program) {
        const builder = descriptor ? "defineNode" : entry ? "defineEntry" : "bindNode";
        const exports = [];
        for (const statement of program.body) {
          if (entry && statement.type === "ImportDeclaration") {
            const source = statement.source.value;
            if (
              source !== "@house-rules/application/contract" &&
              relativeSource(filename, source) !== path.join(path.dirname(filename), "node.ts")
            )
              context.report({ node: statement, messageId: "entryImport" });
          }
          if (
            descriptor &&
            statement.type === "ImportDeclaration" &&
            statement.importKind !== "type"
          ) {
            const source = statement.source.value;
            const target = relativeSource(filename, source);
            const allowed =
              source === "effect"
                ? statement.specifiers.every(
                    (spec) =>
                      spec.importKind === "type" ||
                      (spec.type === "ImportSpecifier" && spec.imported.name === "Schema"),
                  )
                : source === "@house-rules/domain/contract" ||
                  /^@?[^.].*\/contract$/u.test(source) ||
                  (target &&
                    (/\/features\/[^/]+\/node\.ts$/u.test(target) ||
                      /\/read-models\/[^/]+\/contract\.ts$/u.test(target)));
            if (!allowed) context.report({ node: statement, messageId: "import" });
          }
          if (statement.type === "ExportNamedDeclaration" && statement.exportKind !== "type") {
            const declaration = statement.declaration;
            if (declaration?.type === "VariableDeclaration") {
              for (const value of declaration.declarations)
                exports.push({
                  node: value,
                  value:
                    declaration.kind === "const"
                      ? callImport(value.init, context.sourceCode)
                      : undefined,
                });
            } else if (
              declaration &&
              !["TSTypeAliasDeclaration", "TSInterfaceDeclaration"].includes(declaration.type) &&
              !declaration.declare
            )
              exports.push({ node: statement });
            else if (!declaration)
              for (const spec of statement.specifiers)
                if (spec.exportKind !== "type") exports.push({ node: spec });
          } else if (
            ["ExportDefaultDeclaration", "ExportAllDeclaration", "TSExportAssignment"].includes(
              statement.type,
            ) &&
            statement.exportKind !== "type"
          )
            exports.push({ node: statement });
        }
        const source = descriptor
          ? "@house-rules/domain/contract"
          : entry
            ? "@house-rules/application/contract"
            : "@house-rules/application";
        if (
          exports.length !== 1 ||
          exports[0]?.value?.imported !== builder ||
          exports[0]?.value?.source !== source
        ) {
          context.report({
            node: program,
            messageId: "shape",
            data: { file: path.basename(filename), builder, door: source },
          });
        }
        if (!descriptor && exports[0]?.value?.imported === builder) {
          const target = unwrapExpression(exports[0].value.call.arguments[0]);
          const binding = importOf(target, context.sourceCode);
          if (
            !binding ||
            (entry && (binding.imported === "*" || binding.imported === "default")) ||
            relativeSource(filename, binding.source) !==
              path.join(path.dirname(filename), "node.ts")
          )
            context.report({ node: target ?? program, messageId: "own" });
        }
      },
    };
  },
};
