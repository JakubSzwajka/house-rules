import * as fs from "node:fs";
import path from "node:path";
import { staticPropertyName } from "./import-bindings.mjs";
import { matchesAnyGlob } from "./file-globs.mjs";
import { ruleDocsUrl } from "./rule-docs.mjs";
import { sourceGraph } from "./source-provenance.mjs";
import { sourceGlob, sourceJson } from "./source-cache.mjs";

export const esmOnlyEffectRule = {
  meta: {
    type: "problem",
    docs: {
      url: ruleDocsUrl("esm-only-effect"),
      description:
        "Require ESM loading in production app and Effect workspace-package src, including both kits; tests, rules and top-level tooling are excluded.",
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
      esm: "Production Effect source uses ESM imports, never require, module.require or node:module/module createRequire.",
    },
  },
  create(context) {
    const filename = path.resolve(context.physicalFilename ?? context.filename);
    const roots = context.options[0] ?? {};
    const apps = roots.appsDir ?? ["apps"];
    const packages = roots.packagesDir ?? ["packages"];
    const manifests = sourceGlob(
      context.cwd,
      [...apps, ...packages].map((root) => `${root}/*/package.json`),
    );
    let owner;
    let effect = false;
    for (const manifest of manifests) {
      const directory = path.dirname(path.resolve(context.cwd, manifest));
      if (!filename.startsWith(`${directory}${path.sep}src${path.sep}`)) continue;
      owner = directory;
      try {
        const json = sourceJson(path.resolve(context.cwd, manifest));
        if (
          json.name === "@house-rules/rules" &&
          fs.realpathSync(directory) === fs.realpathSync(path.resolve(import.meta.dirname, ".."))
        )
          return {};
        effect =
          matchesAnyGlob(
            filename,
            context.cwd,
            apps.map((root) => `${root}/*/src/**/*`),
          ) ||
          ["@house-rules/domain", "@house-rules/application"].includes(json.name) ||
          "effect" in { ...json.dependencies, ...json.devDependencies, ...json.peerDependencies };
        if (!effect && fs.existsSync(path.join(directory, "tsconfig.json"))) {
          const config = sourceJson(path.join(directory, "tsconfig.json"));
          effect = [config.extends]
            .flat()
            .some(
              (entry) => typeof entry === "string" && /(?:^|\/)effect(?:\.json)?$/u.test(entry),
            );
        }
      } catch {
        /* unreadable metadata grants no package classification */
      }
      break;
    }
    if (!owner || !effect) return {};
    const relative = path.relative(path.join(owner, "src"), filename).split(path.sep).join("/");
    if (/(?:^|\/)(?:tests?|__tests__)\/|\.(?:test|spec)\./u.test(relative)) return {};
    const { sourceCode } = context;
    const free = (node) => {
      let scope = sourceCode.getScope(node);
      while (scope) {
        if (scope.set.get(node.name)?.defs.length) return false;
        scope = scope.upper;
      }
      return true;
    };
    const moduleObject = (node, seen = new Set()) => {
      if (node.type !== "Identifier" || seen.has(node)) return false;
      if (node.name === "module" && free(node)) return true;
      const def = sourceCode.scopeManager.scopes
        .flatMap((scope) => scope.references)
        .find((ref) => ref.identifier === node)?.resolved?.defs[0];
      return def?.type === "Variable" && def.node.init
        ? moduleObject(def.node.init, new Set([...seen, node]))
        : false;
    };
    const report = (node) => context.report({ node, messageId: "esm" });
    let graph;
    const moduleSource = (source) => ["node:module", "module"].includes(source);
    return {
      Program(program) {
        graph = sourceGraph(filename, program, sourceCode.scopeManager, {
          cwd: context.cwd,
          packagesDir: packages,
        });
      },
      "Program:exit"() {
        for (const scope of sourceCode.scopeManager.scopes)
          for (const ref of scope.references) {
            const node = ref.identifier;
            if (node.name === "require" && free(node)) report(node);
            else if (ref.resolved?.defs[0]?.node.type === "ImportSpecifier") {
              const binding = graph.resolve(filename, node, new Set(), true);
              const direct = ref.resolved.defs[0].parent.source.value;
              if (
                !moduleSource(direct) &&
                moduleSource(binding?.source) &&
                binding.imported === "createRequire"
              )
                report(node);
            }
          }
      },
      ImportExpression(node) {
        if (moduleSource(node.source.value)) report(node);
      },
      ExportNamedDeclaration(node) {
        if (node.exportKind === "type") return;
        for (const spec of node.specifiers) {
          if (spec.exportKind === "type") continue;
          const name = spec.local.name ?? spec.local.value;
          const binding = node.source
            ? graph.resolve(filename, { type: "Identifier", name })
            : graph.resolve(filename, spec.local);
          if (
            (moduleSource(node.source?.value) && name === "createRequire") ||
            (moduleSource(binding?.source) && binding.imported === "createRequire")
          )
            report(spec);
        }
      },
      ExportAllDeclaration(node) {
        if (node.exportKind !== "type" && moduleSource(node.source.value)) report(node);
      },
      MemberExpression(node) {
        const name = staticPropertyName(node);
        if (
          name === "require" &&
          (moduleObject(node.object) ||
            (node.object.type === "Identifier" &&
              node.object.name === "globalThis" &&
              free(node.object)))
        )
          report(node);
        const binding = graph.resolve(filename, node, new Set(), true);
        if (
          name === "createRequire" &&
          moduleSource(binding?.source) &&
          binding.imported === "createRequire"
        )
          report(node);
      },
      ImportSpecifier(node) {
        if (
          node.importKind !== "type" &&
          node.parent.importKind !== "type" &&
          moduleSource(node.parent.source.value) &&
          (node.imported.name ?? node.imported.value) === "createRequire"
        )
          report(node);
      },
      VariableDeclarator(node) {
        if (node.id.type !== "ObjectPattern" || !node.init) return;
        const binding = graph.resolve(filename, node.init, new Set(), true);
        for (const item of node.id.properties) {
          const name = item.key?.name ?? item.key?.value;
          if (
            item.type === "Property" &&
            ((name === "require" && moduleObject(node.init)) ||
              (name === "createRequire" &&
                moduleSource(binding?.source) &&
                ["*", "default"].includes(binding.imported)))
          )
            report(item);
        }
      },
      TSImportEqualsDeclaration(node) {
        if (node.moduleReference.type === "TSExternalModuleReference") report(node);
      },
    };
  },
};
