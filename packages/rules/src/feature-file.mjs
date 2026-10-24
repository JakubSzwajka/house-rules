import fs from "node:fs";
import path from "node:path";
import { matchesAnyGlob } from "./file-globs.mjs";
import { importOf, unwrapExpression } from "./import-bindings.mjs";
import { ruleDocsUrl } from "./rule-docs.mjs";
import { relativeSource } from "./source-provenance.mjs";

const featureTarget = (filename, source, root) => {
  const target = relativeSource(filename, source);
  return (
    target && path.dirname(path.dirname(target)) === root && path.basename(target) === "index.ts"
  );
};
const featureImport = (filename, source, root) => {
  const target = relativeSource(filename, source);
  return (
    source === "effect" ||
    /^(?:@[\w.-]+\/)?[\w-][\w.-]*\/contract$/u.test(source) ||
    (target &&
      path.dirname(path.dirname(path.dirname(target))) === path.dirname(root) &&
      /\/read-models\/[^/]+\/contract\.ts$/u.test(target))
  );
};
const typeDeclaration = (node) =>
  ["TSTypeAliasDeclaration", "TSInterfaceDeclaration"].includes(node?.type);

export const featureFileRule = {
  meta: {
    type: "problem",
    docs: {
      url: ruleDocsUrl("feature-file"),
      description:
        "Require one directly exported defineFeature per feature index, no imports of other feature indexes, index.ts and tests/ only, and a registry limited to Features and feature/type re-exports.",
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
        "A feature index contains exactly one defineFeature call, exported as a direct const value imported by name from @house-rules/application/contract; type exports are allowed.",
      folder: "A feature folder contains only index.ts and tests/.",
      import:
        "A feature imports only effect, kit contract doors, package ./contract doors and same-app read-model contract doors, never another feature index.",
      registry:
        "The feature registry only builds a Features object from named feature imports and permits feature re-exports and type exports; permission lists belong in composition/access.ts.",
    },
  },
  create(context) {
    const filename = path.resolve(context.physicalFilename ?? context.filename);
    const roots = context.options[0]?.appsDir ?? ["apps"];
    if (
      !matchesAnyGlob(
        filename,
        context.cwd,
        roots.map((root) => `${root}/*/src/features/**/*`),
      )
    )
      return {};
    const relative = filename
      .split(`${path.sep}src${path.sep}features${path.sep}`)
      .at(-1)
      .split(path.sep);
    if (relative.slice(1).includes("tests")) return {};
    const registry = relative.length === 1 && relative[0] === "index.ts";
    const index = relative.length === 2 && relative[1] === "index.ts";
    const featureRoot = registry ? path.dirname(filename) : path.dirname(path.dirname(filename));
    const report = (node, messageId) => context.report({ node, messageId });
    const importedFeature = (node) => {
      const binding = importOf(node, context.sourceCode);
      return (
        binding &&
        !["*", "default"].includes(binding.imported) &&
        featureTarget(filename, binding.source, featureRoot)
      );
    };
    const featureObject = (node) => {
      const value = unwrapExpression(node);
      return (
        value?.type === "ObjectExpression" &&
        value.properties.every(
          (item) =>
            item.type === "Property" &&
            !item.computed &&
            item.kind === "init" &&
            importedFeature(item.value),
        )
      );
    };
    const calls = [];
    let exportedCall;
    let validShape = false;
    return {
      CallExpression(node) {
        const binding = importOf(unwrapExpression(node.callee), context.sourceCode);
        if (
          binding?.imported === "defineFeature" &&
          binding.source === "@house-rules/application/contract"
        )
          calls.push(node);
      },
      "Program:exit"(program) {
        if (index && validShape && (calls.length !== 1 || calls[0] !== exportedCall))
          report(program, "shape");
      },
      ImportExpression(node) {
        const source = node.source.value;
        if (registry || typeof source !== "string" || !featureImport(filename, source, featureRoot))
          report(node, registry ? "registry" : "import");
      },
      Program(program) {
        if (!registry && !index) {
          report(program, "folder");
          return;
        }
        if (index && fs.existsSync(path.dirname(filename))) {
          const invalid = fs
            .readdirSync(path.dirname(filename), { withFileTypes: true })
            .some(
              (item) =>
                !(
                  (item.name === "index.ts" && item.isFile()) ||
                  (item.name === "tests" && item.isDirectory())
                ),
            );
          if (invalid) report(program, "folder");
        }
        const values = [];
        for (const statement of program.body) {
          if (
            ["ImportDeclaration", "ExportNamedDeclaration", "ExportAllDeclaration"].includes(
              statement.type,
            ) &&
            statement.source
          ) {
            const source = statement.source.value;
            const allowed = registry
              ? featureTarget(filename, source, featureRoot)
              : featureImport(filename, source, featureRoot);
            if (!allowed) report(statement, registry ? "registry" : "import");
          }
          if (registry) {
            if (
              statement.type === "ImportDeclaration" ||
              typeDeclaration(statement) ||
              statement.type === "EmptyStatement"
            )
              continue;
            if (statement.exportKind === "type") continue;
            if (
              ["ExportAllDeclaration", "ExportNamedDeclaration"].includes(statement.type) &&
              statement.source
            ) {
              if (!featureTarget(filename, statement.source.value, featureRoot))
                report(statement, "registry");
              continue;
            }
            const declaration =
              statement.type === "ExportNamedDeclaration" ? statement.declaration : statement;
            if (typeDeclaration(declaration)) continue;
            if (declaration?.type === "VariableDeclaration" && declaration.kind === "const") {
              for (const value of declaration.declarations) {
                if (
                  !(
                    value.id.type === "Identifier" &&
                    value.id.name === "Features" &&
                    featureObject(value.init)
                  )
                )
                  report(value, "registry");
              }
            } else if (
              statement.type === "ExportNamedDeclaration" &&
              !declaration &&
              statement.specifiers.every(
                (spec) => spec.exportKind === "type" || importedFeature(spec.local),
              )
            ) {
              continue;
            } else report(statement, "registry");
            continue;
          }
          if (statement.type === "ExportNamedDeclaration" && statement.exportKind !== "type") {
            const declaration = statement.declaration;
            if (declaration?.type === "VariableDeclaration") {
              for (const value of declaration.declarations)
                values.push(
                  declaration.kind === "const" && value.id.type === "Identifier"
                    ? value.init
                    : undefined,
                );
            } else if (!typeDeclaration(declaration)) {
              if (!declaration)
                values.push(...statement.specifiers.filter((spec) => spec.exportKind !== "type"));
              else values.push(undefined);
            }
          } else if (
            ["ExportDefaultDeclaration", "ExportAllDeclaration", "TSExportAssignment"].includes(
              statement.type,
            ) &&
            statement.exportKind !== "type"
          )
            values.push(undefined);
        }
        if (!registry) {
          const call = unwrapExpression(values[0]);
          exportedCall = call;
          const binding =
            call?.type === "CallExpression" &&
            importOf(unwrapExpression(call.callee), context.sourceCode);
          if (
            values.length !== 1 ||
            binding?.imported !== "defineFeature" ||
            binding.source !== "@house-rules/application/contract"
          )
            report(program, "shape");
          else validShape = true;
        }
      },
    };
  },
};
