import path from "node:path";
import { forbiddenBuilderImports, kitImplementation } from "./kit-builder-source.mjs";
import { matchesAnyGlob } from "./file-globs.mjs";
import { importOf, staticPropertyName, unwrapExpression } from "./import-bindings.mjs";
import { sourceGraph } from "./source-provenance.mjs";
import { ruleDocsUrl } from "./rule-docs.mjs";

const application = (source) =>
  source === "@house-rules/application" || source === "@house-rules/application/contract";
const builders = new Set(["defineNode", "bindNode", "defineEntry", "defineWay", "endpoint"]);
const door = (name) =>
  name === "defineNode"
    ? "@house-rules/domain/contract"
    : ["bindNode", "defineWay"].includes(name)
      ? "@house-rules/application"
      : "@house-rules/application/contract";
const approved = (binding) =>
  ["defineNode", "bindNode", "defineWay"].includes(binding?.imported)
    ? binding.source === door(binding.imported)
    : application(binding?.source);
const property = (node, name) =>
  node?.type === "ObjectExpression"
    ? node.properties.find(
        (item) => item.type === "Property" && (item.key.name ?? item.key.value) === name,
      )?.value
    : undefined;

export const entryFromAppNodeRule = {
  meta: {
    type: "problem",
    docs: {
      url: ruleDocsUrl("entry-from-app-node"),
      description:
        "Require direct named kit builders, forbid workspace-package entry/way/endpoint imports and any kit-builder re-export, allow finished descriptors/binders, and follow entries to this app's literal features folder.",
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
        "Entries, including hooks and schedules, must resolve to this app's own features/<name>/node.ts descriptor, never packages, read models or composition.",
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
    const rootPattern = roots
      .map((root) =>
        root
          .split("/")
          .map((part) => (part === "*" ? "[^/]+" : part.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")))
          .join("/"),
      )
      .join("|");
    const prefix = new RegExp(`^(?:${rootPattern})/[^/]+/src/`, "u").exec(relative)?.[0];
    if (!prefix && !inPackage) return {};
    const app = prefix ? `${path.resolve(context.cwd, prefix)}${path.sep}` : undefined;
    const check = (file, expression, kind, seen = new Set()) => {
      const found = graph.resolve(file, expression);
      if (!found?.node || seen.has(found.node)) return false;
      const next = new Set([...seen, found.node]);
      const node = unwrapExpression(found.node);
      if (node.type === "CallExpression") {
        const binding = graph.builder(found.file, node.callee);
        if (kind === "node")
          return (
            app !== undefined &&
            binding?.source === "@house-rules/domain/contract" &&
            binding.imported === "defineNode" &&
            found.file.startsWith(`${app}features/`) &&
            /^features\/[^/]+\/node\.ts$/u.test(found.file.slice(app.length))
          );
        if (application(binding?.source) && binding.imported === "defineEntry")
          return check(found.file, node.arguments[0], "node", next);
        if (application(binding?.source) && binding.imported === "endpoint")
          return check(found.file, node.arguments[0], "entry", next);
      }
      if (kind === "entries" && node.type === "ArrayExpression")
        return node.elements.every((item) => item && check(found.file, item, "entry", next));
      return false;
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
          node.source.value === door("defineNode")
        )
          for (const name of names.length
            ? names
            : [node.source.value === door("defineNode") ? "defineNode" : "defineEntry"])
            named(node, name);
      },
      ExportAllDeclaration(node) {
        if (node.exportKind === "type") return;
        const origin = graph.packageBuilder(filename, node.source.value);
        const domain = /^@house-rules\/domain(?:\/contract)?$/u.test(node.source.value);
        if (application(node.source.value) || domain || origin)
          named(node, origin?.imported ?? (domain ? "defineNode" : "defineEntry"));
      },
      MemberExpression(node) {
        const name = staticPropertyName(node);
        const imported = importOf(node.object, context.sourceCode);
        const resolved = graph.resolve(filename, node.object);
        const member = graph.resolve(filename, node);
        const kit =
          application(resolved?.source) ||
          resolved?.source === door("defineNode") ||
          application(member?.source) ||
          member?.source === door("defineNode");
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
            (application(imported.source) || imported.source === door("defineNode")) &&
            (parent?.type !== "MemberExpression" || parent.computed)
          )
            named(
              node,
              builders.has(name)
                ? name
                : imported.source === door("defineNode")
                  ? "defineNode"
                  : "defineEntry",
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
            imported.imported !== "bindNode" &&
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
              origin?.imported ?? (source === door("defineNode") ? "defineNode" : "defineEntry"),
            );
          return;
        }
        const callee = unwrapExpression(node.callee);
        const binding =
          callee.type === "Identifier" ? importOf(callee, context.sourceCode) : undefined;
        const name = binding?.imported;
        if (!approved(binding) || !["defineEntry", "endpoint", "defineWay"].includes(name)) return;
        const valid =
          !inPackage &&
          (name === "defineEntry"
            ? check(filename, node.arguments[0], "node")
            : name === "endpoint"
              ? check(filename, node.arguments[0], "entry")
              : check(
                  filename,
                  property(unwrapExpression(node.arguments[0]), "entries"),
                  "entries",
                ));
        if (!valid) {
          if (inPackage) named(node, name);
          else context.report({ node, messageId: "origin" });
        }
      },
    };
  },
};
