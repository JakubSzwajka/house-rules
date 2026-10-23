import path from "node:path";
import { forbiddenBuilderImports, kitImplementation } from "./kit-builder-source.mjs";
import { matchesAnyGlob } from "./file-globs.mjs";
import { importOf, staticPropertyName, unwrapExpression } from "./import-bindings.mjs";
import { sourceGraph } from "./source-provenance.mjs";
import { featureOrigin, featureOptions } from "./feature-origin.mjs";
import { ruleDocsUrl } from "./rule-docs.mjs";
const application = (source) => /^@house-rules\/application(?:\/contract)?$/u.test(source);
const builders = new Set([
  "defineOperation",
  "bindOperation",
  "defineFeature",
  "defineWay",
  "endpoint",
]);
const door = (name) =>
  name === "defineOperation"
    ? "@house-rules/domain/contract"
    : ["bindOperation", "defineWay"].includes(name)
      ? "@house-rules/application"
      : "@house-rules/application/contract";
const approved = (binding) =>
  builders.has(binding?.imported) && binding.source === door(binding.imported);
export const featureBuildersRule = {
  meta: {
    type: "problem",
    docs: {
      url: ruleDocsUrl("feature-builders"),
      description:
        "Require direct named kit builders, inline builder options, one-file feature origins for HTTP/MCP exposures and resolved hook/schedule system starts, May.context and May.system, and operation builders outside features.",
    },
    schema: [
      {
        type: "object",
        properties: {
          appsDir: { type: "array", items: { type: "string" } },
          packagesDir: { type: "array", items: { type: "string" } },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      named:
        "Import {{name}} by name from {{door}} and call it directly; no namespace, runtime alias, barrel, callback or dynamic import.",
      origin:
        "Call defineFeature only in features/<name>/index.ts; do not call defineOperation or bindOperation in features/.",
      options:
        "Pass builder options inline with no spread, computed keys or getters; pass features inline, once, for May.context and defineWay.",
      system: "Hook and schedule ways expose only features with an explicit system start.",
      exposure:
        "Exposed or started features must resolve to this app's defineFeature in features/<name>/index.ts, directly or through its Features registry.",
    },
  },
  create(context) {
    const filename = path.resolve(context.physicalFilename ?? context.filename);
    const roots = context.options[0]?.appsDir ?? ["apps"];
    const packageRoots = context.options[0]?.packagesDir ?? ["packages"];
    const inPackage = matchesAnyGlob(
      filename,
      context.cwd,
      packageRoots.map((root) => `${root}/*/src/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}`),
    );
    const relative = path.relative(context.cwd, filename).split(path.sep).join("/");
    if (inPackage && kitImplementation(filename, context.cwd, packageRoots)) return {};
    if (
      (!inPackage &&
        !matchesAnyGlob(
          filename,
          context.cwd,
          roots.map((root) => `${root}/*/src/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}`),
        )) ||
      /(?:^|\/)(?:tests?|__tests__)\/|\.(?:test|spec)\./u.test(
        relative.replace(/^.*?\/[^/]+\/src\//u, ""),
      )
    )
      return {};
    let graph;
    let references;
    const named = (node, name) =>
      context.report({ node, messageId: "named", data: { name, door: door(name) } });
    const featureFile = matchesAnyGlob(
      filename,
      context.cwd,
      roots.map((root) => `${root}/*/src/features/*/index.ts`),
    );
    const inFeatures = matchesAnyGlob(
      filename,
      context.cwd,
      roots.map((root) => `${root}/*/src/features/**/*`),
    );
    const app = filename.slice(0, filename.lastIndexOf(`${path.sep}src${path.sep}`) + 5);
    const exposure = (node, expression, list = false) => {
      if (!featureOrigin(graph, app, filename, expression, list))
        context.report({ node, messageId: "exposure" });
    };
    const optionFeatures = (node, expression, features = true, publicList = false) => {
      const messages = featureOptions(graph, app, filename, expression, features, publicList);
      for (const messageId of messages) context.report({ node, messageId });
    };
    return {
      Program(program) {
        graph = sourceGraph(filename, program, context.sourceCode.scopeManager, {
          cwd: context.cwd,
          packagesDir: packageRoots,
        });
        references = new Set(
          context.sourceCode.scopeManager.scopes
            .flatMap((scope) => scope.references)
            .map((ref) => ref.identifier),
        );
      },
      ImportDeclaration(node) {
        if (inPackage) forbiddenBuilderImports(context, graph, filename, node, named);
      },
      ImportExpression(node) {
        const parent = node.parent?.type === "AwaitExpression" ? node.parent.parent : node.parent;
        const names =
          parent?.type === "VariableDeclarator" && parent.id.type === "ObjectPattern"
            ? parent.id.properties
                .map((prop) => prop.key?.name ?? prop.key?.value)
                .filter((name) => builders.has(name))
            : [];
        if (
          names.length ||
          application(node.source.value) ||
          node.source.value === door("defineOperation")
        )
          for (const name of names.length
            ? names
            : [node.source.value === door("defineOperation") ? "defineOperation" : "defineFeature"])
            named(node, name);
      },
      ExportAllDeclaration(node) {
        if (node.exportKind === "type") return;
        const origin = graph.packageBuilder(filename, node.source.value);
        const domain = /^@house-rules\/domain(?:\/contract)?$/u.test(node.source.value);
        if (application(node.source.value) || domain || origin)
          named(node, origin?.imported ?? (domain ? "defineOperation" : "defineFeature"));
      },
      MemberExpression(node) {
        const name = staticPropertyName(node);
        const imported = importOf(node.object, context.sourceCode);
        const resolved = graph.resolve(filename, node.object);
        const member = graph.resolve(filename, node);
        const kit =
          application(resolved?.source) ||
          resolved?.source === door("defineOperation") ||
          application(member?.source) ||
          member?.source === door("defineOperation");
        const unresolved =
          imported?.source.startsWith(".") && (!resolved || resolved.source?.startsWith("."));
        const origin = graph.builderOrigin(filename, node);
        if (builders.has(name) && (kit || unresolved)) named(node, name);
        else if (origin && (!imported || ["*", "default"].includes(imported.imported)))
          named(node, origin.imported);
        else if (node.computed) {
          const packageOrigin = graph.builderOrigin(filename, node.object);
          if (packageOrigin) named(node, packageOrigin.imported);
        }
      },
      ExportNamedDeclaration(node) {
        if (node.exportKind === "type") return;
        for (const spec of node.specifiers) {
          if (spec.exportKind === "type") continue;
          const name = spec.local.name ?? spec.local.value;
          const origin = node.source
            ? /^@house-rules\/(?:domain|application)(?:\/contract)?$/u.test(node.source.value)
              ? { imported: name }
              : graph.packageBuilder(filename, node.source.value, name)
            : graph.builderOrigin(filename, spec.local);
          if (builders.has(origin?.imported)) named(spec, origin.imported);
        }
      },
      Identifier(node) {
        if (!references.has(node) || ["TSTypeQuery", "TSQualifiedName"].includes(node.parent?.type))
          return;
        const imported = importOf(node, context.sourceCode);
        if (!imported) return;
        if (
          imported.imported === "default" &&
          node.parent?.type === "MemberExpression" &&
          node.parent.object === node
        )
          return;
        if (imported.imported === "*") {
          const parent = node.parent;
          const name =
            parent?.type === "MemberExpression" && parent.object === node
              ? staticPropertyName(parent)
              : undefined;
          if (builders.has(name)) return;
          if (
            (application(imported.source) || imported.source === door("defineOperation")) &&
            (parent?.type !== "MemberExpression" || parent.computed)
          )
            named(
              node,
              builders.has(name)
                ? name
                : imported.source === door("defineOperation")
                  ? "defineOperation"
                  : "defineFeature",
            );
          return;
        }
        const origin =
          builders.has(imported.imported) &&
          (imported.source.startsWith("@house-rules/") || imported.source.startsWith("."))
            ? imported
            : graph.builderOrigin(filename, node);
        if (!builders.has(origin?.imported)) return;
        let use = node;
        while (
          [
            "TSAsExpression",
            "TSSatisfiesExpression",
            "TSNonNullExpression",
            "TSInstantiationExpression",
          ].includes(use.parent?.type)
        )
          use = use.parent;
        if (
          !builders.has(imported.imported) ||
          !approved(imported) ||
          use.parent?.type !== "CallExpression" ||
          use.parent.callee !== use ||
          (inPackage &&
            imported.imported !== "bindOperation" &&
            (() => {
              for (let parent = use.parent; parent; parent = parent.parent)
                if (
                  ["ArrowFunctionExpression", "FunctionExpression", "FunctionDeclaration"].includes(
                    parent.type,
                  )
                )
                  return true;
              return false;
            })())
        )
          named(node, origin.imported);
      },
      CallExpression(node) {
        if (graph.isRequire(filename, node.callee)) {
          const source =
            node.arguments[0]?.type === "Literal" ? node.arguments[0].value : undefined;
          const origin =
            typeof source === "string" ? graph.packageBuilder(filename, source) : undefined;
          if (
            typeof source !== "string" ||
            /^@house-rules\/(?:domain|application)(?:\/|$)/u.test(source) ||
            origin
          )
            named(
              node,
              origin?.imported ??
                (source === door("defineOperation") ? "defineOperation" : "defineFeature"),
            );
          return;
        }
        const callee = unwrapExpression(node.callee);
        const binding =
          callee.type === "Identifier" ? importOf(callee, context.sourceCode) : undefined;
        const name = binding?.imported;
        const origin = graph.resolve(filename, callee);
        if (application(origin?.source) && origin.imported === "runFeature")
          exposure(node, node.arguments[0]);
        if (
          callee.type === "MemberExpression" &&
          ["context", "system"].includes(staticPropertyName(callee))
        ) {
          const owner = graph.resolve(filename, callee.object);
          if (application(owner?.source) && owner.imported === "May") {
            if (staticPropertyName(callee) === "context") optionFeatures(node, node.arguments[1]);
            else {
              exposure(node, node.arguments[0], true);
              optionFeatures(node, node.arguments[1], false);
            }
          }
        }
        if (!inPackage && name === "endpoint" && approved(binding))
          exposure(node, node.arguments[0]);
        if (!inPackage && name === "defineWay" && approved(binding))
          optionFeatures(node, node.arguments[0], true, true);
        if (!approved(binding)) return;
        if (inPackage && ["defineFeature", "endpoint", "defineWay"].includes(name)) {
          named(node, name);
        } else if (
          (name === "defineFeature" && !featureFile) ||
          (["defineOperation", "bindOperation"].includes(name) && inFeatures)
        )
          context.report({ node, messageId: "origin" });
      },
    };
  },
};
