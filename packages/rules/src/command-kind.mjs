import path from "node:path";
import { importOf, staticPropertyName, unwrapExpression } from "./import-bindings.mjs";
import { kitImplementation } from "./kit-builder-source.mjs";
import { sourceGraph } from "./source-provenance.mjs";
import { ruleDocsUrl } from "./rule-docs.mjs";
import { workspaceDirectories, workspaceRoot } from "./workspaces.mjs";

const application = (source) => /^@house-rules\/application(?:\/contract)?$/u.test(source);
const commandBuilder = (origin) =>
  origin?.imported === "defineFeature" && application(origin.source);

const literalSource = (node) => {
  if (node?.type === "Literal" && typeof node.value === "string") return node.value;
  if (node?.type === "TemplateLiteral" && node.expressions.length === 0)
    return node.quasis[0].value.cooked;
  return undefined;
};

const plainProperty = (node) =>
  node.type === "Property" && !node.computed && node.kind === "init" && !node.method;

export const commandKindRule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Require command features with literal flags; author queries with defineReadModel.",
      url: ruleDocsUrl("command-kind"),
    },
    schema: [],
    messages: {
      command: "Commands cannot declare readOnly true. Use defineReadModel in read-models/.",
      flags:
        "Command options and flags must be inline objects with literal boolean flags, without spreads, computed keys, accessors, methods, duplicate keys or __proto__.",
      builder:
        "Call defineFeature directly through a named kit import; do not pass, wrap or load the builder indirectly.",
    },
  },
  create(context) {
    const filename = path.resolve(context.physicalFilename ?? context.filename);
    const cwd = workspaceRoot(context.cwd);
    const production = (file) => {
      const relative = path.relative(cwd, file).split(path.sep).join("/");
      const source = relative.match(/(?:^|\/)src\/(.*)$/u)?.[1];
      const testPath = source?.replace(/^(?:features|read-models|ways-in)\/[^/]+\//u, "");
      return source && !/(?:^|\/)(?:tests?|__tests__)\/|\.(?:test|spec)\./u.test(testPath);
    };
    if (!production(filename)) return {};
    let workspaces;
    const directories = () => (workspaces ??= workspaceDirectories(cwd));
    if (
      /\/(?:domain|application)\/src\//u.test(filename.split(path.sep).join("/")) &&
      kitImplementation(filename, cwd, [
        "packages",
        ...directories().map((folder) => path.dirname(folder)),
      ])
    )
      return {};
    let graph;
    let program;
    let references;
    const provenance = () =>
      (graph ??= sourceGraph(filename, program, context.sourceCode.scopeManager, {
        cwd,
        packagesDir: ["packages"],
        workspaces: directories(),
      }));
    const indirect = (node) => context.report({ node, messageId: "builder" });
    const commandOrigin = (node, completed = false) =>
      provenance().builderOrigin(filename, node, { imported: "defineFeature", completed });
    const loadedBuilder = (node, expression) => {
      const source = literalSource(expression);
      if (
        source === undefined ||
        /^@house-rules\/(?:domain|application)(?:\/contract)?$/u.test(source) ||
        provenance().packageBuilder(filename, source) ||
        provenance().packageBuilder(filename, source, undefined, {
          imported: "defineFeature",
          completed: true,
        })
      )
        indirect(node);
    };
    const globalReflect = (node) => {
      if (node?.type !== "Identifier" || node.name !== "Reflect") return false;
      for (let scope = context.sourceCode.getScope(node); scope; scope = scope.upper)
        if (scope.set.get("Reflect")?.defs.length) return false;
      return true;
    };
    const reject = (node) => context.report({ node, messageId: "flags" });
    const properties = (expression, reportNode) => {
      const object = unwrapExpression(expression);
      if (object?.type !== "ObjectExpression") {
        reject(reportNode);
        return [];
      }
      const keys = new Set();
      return object.properties.filter((property) => {
        const key = property.key?.name ?? property.key?.value;
        if (!plainProperty(property) || keys.has(key) || key === "__proto__") {
          reject(property);
          return false;
        }
        keys.add(key);
        return true;
      });
    };
    return {
      Program(node) {
        program = node;
        references = new Set(
          context.sourceCode.scopeManager.scopes.flatMap((scope) =>
            scope.references
              .filter((reference) => reference.isValueReference)
              .map((reference) => reference.identifier),
          ),
        );
      },
      Identifier(node) {
        if (!references.has(node)) return;
        const imported = importOf(node, context.sourceCode);
        if (imported?.imported === "*" && application(imported.source)) {
          if (node.parent?.type !== "MemberExpression" || !staticPropertyName(node.parent))
            indirect(node);
          return;
        }
        const completed = commandOrigin(node, true);
        if (commandBuilder(completed) && completed.file && !production(completed.file)) {
          indirect(node);
          return;
        }
        if (!commandBuilder(commandOrigin(node))) return;
        let use = node;
        while (use.parent && unwrapExpression(use.parent) === node) use = use.parent;
        if (
          !commandBuilder(imported) ||
          use.parent?.type !== "CallExpression" ||
          use.parent.callee !== use
        )
          indirect(node);
      },
      MemberExpression(node) {
        const found = provenance().resolve(filename, node, new Set(), true);
        if (
          commandBuilder(commandOrigin(node)) ||
          (found?.file && !production(found.file) && commandBuilder(commandOrigin(node, true)))
        )
          indirect(node);
      },
      ImportExpression(node) {
        loadedBuilder(node, node.source);
      },
      ExportAllDeclaration(node) {
        if (node.exportKind === "type") return;
        const origin = provenance().packageBuilder(filename, node.source.value, undefined, {
          imported: "defineFeature",
          completed: true,
        });
        if (commandBuilder(origin) && origin.file && !production(origin.file)) indirect(node);
      },
      ExportNamedDeclaration(node) {
        if (!node.source || node.exportKind === "type") return;
        for (const spec of node.specifiers) {
          if (spec.exportKind === "type") continue;
          const origin = provenance().packageBuilder(
            filename,
            node.source.value,
            spec.local.name ?? spec.local.value,
            { imported: "defineFeature", completed: true },
          );
          if (commandBuilder(origin) && origin.file && !production(origin.file)) indirect(spec);
        }
      },
      TSImportEqualsDeclaration(node) {
        if (!node.isTypeOnly && node.moduleReference.type === "TSExternalModuleReference")
          loadedBuilder(node, node.moduleReference.expression);
      },
      CallExpression(node) {
        const callee = unwrapExpression(node.callee);
        if (provenance().isRequire(filename, callee)) {
          loadedBuilder(node, node.arguments[0]);
          return;
        }
        if (
          callee?.type === "MemberExpression" &&
          provenance().isRequire(filename, callee.object)
        ) {
          const method = staticPropertyName(callee);
          if (!method) {
            indirect(node);
            return;
          }
          if (method === "call" || method === "apply") {
            loadedBuilder(
              node,
              method === "call"
                ? node.arguments[1]
                : unwrapExpression(node.arguments[1])?.elements?.[0],
            );
            return;
          }
        }
        if (
          callee?.type === "MemberExpression" &&
          staticPropertyName(callee) === "apply" &&
          globalReflect(callee.object) &&
          provenance().isRequire(filename, node.arguments[0])
        ) {
          loadedBuilder(node, unwrapExpression(node.arguments[2])?.elements?.[0]);
          return;
        }
        const origin = provenance().resolve(filename, node.callee, new Set(), true);
        if (!commandBuilder(origin)) return;
        for (const property of properties(node.arguments[1], node)) {
          if ((property.key.name ?? property.key.value) !== "flags") continue;
          for (const flag of properties(property.value, property)) {
            const value = unwrapExpression(flag.value);
            if (value?.type !== "Literal" || typeof value.value !== "boolean") reject(flag);
            else if ((flag.key.name ?? flag.key.value) === "readOnly" && value.value)
              context.report({ node: flag, messageId: "command" });
          }
        }
      },
    };
  },
};
