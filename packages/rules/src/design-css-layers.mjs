import { matchesAnyGlob } from "./file-globs.mjs";
import { ruleDocsUrl } from "./rule-docs.mjs";

const names = { type: "array", items: { type: "string", minLength: 1 }, uniqueItems: true };
const layerName = "^[A-Za-z_-][\\w-]*(\\.[A-Za-z_-][\\w-]*)*$";

function layerOf(node) {
  const list = node.prelude?.children?.[0];
  if (list?.type !== "LayerList") return null;
  return list.children.length === 1 ? list.children[0].name : null;
}

function listed(values) {
  return values.map((value) => `@layer ${value}`).join(", ");
}

export const designCssLayersRule = {
  meta: {
    type: "problem",
    docs: {
      url: ruleDocsUrl("design-css-layers"),
      description:
        "Require every style rule to sit inside an allowed @layer, keep a restricted layer to its files, and disallow !important.",
    },
    messages: {
      unlayered: "{{what}} is outside an allowed layer. Put it inside one of: {{layers}}.",
      layer: "@layer {{name}} is not an allowed layer. Use one of: {{layers}}.",
      anonymous: "An anonymous @layer is not an allowed layer. Use one of: {{layers}}.",
      layerFile: "@layer {{name}} is only allowed in {{files}}.",
      important: "!important is not allowed. Order the cascade with @layer instead.",
    },
    schema: [
      {
        type: "object",
        properties: {
          layers: { ...names, minItems: 1, items: { type: "string", pattern: layerName } },
          layerFiles: {
            type: "object",
            propertyNames: { pattern: layerName },
            additionalProperties: { ...names, minItems: 1 },
          },
          unlayered: names,
          tokenFiles: names,
          checkTokenFiles: { type: "boolean" },
        },
        required: ["layers"],
        additionalProperties: false,
      },
    ],
    defaultOptions: [{ layerFiles: {}, unlayered: [], tokenFiles: [], checkTokenFiles: false }],
  },

  create(context) {
    const [{ layers, layerFiles, unlayered, tokenFiles, checkTokenFiles }] = context.options;
    for (const name of Object.keys(layerFiles)) {
      if (!layers.includes(name)) {
        throw new Error(
          `house-rules/design-css-layers: layerFiles names "${name}", which is not in layers.`,
        );
      }
    }
    const filename = context.physicalFilename ?? context.filename;
    if (!checkTokenFiles && matchesAnyGlob(filename, context.cwd, tokenFiles)) return {};
    const allowedLayers = listed(layers);
    const outsideAt = new Set(unlayered.map((name) => name.toLowerCase()));
    // Each open @layer block: its full dotted name, and whether rules inside it are placed well.
    const open = [];
    const quiet = new Set();
    const inAllowedLayer = () => open.at(-1)?.allowed === true;

    function silence(node) {
      quiet.add(node);
    }

    function placement(node, what) {
      if (quiet.size || inAllowedLayer()) return;
      context.report({ node, messageId: "unlayered", data: { what, layers: allowedLayers } });
      silence(node);
    }

    function enterLayer(node) {
      const parent = open.at(-1);
      const name = layerOf(node);
      const full =
        name === null ? (parent?.full ?? null) : parent?.full ? `${parent.full}.${name}` : name;
      const entry =
        full === null
          ? undefined
          : layers.find((layer) => full === layer || full.startsWith(`${layer}.`));
      open.push({ node, full, allowed: entry !== undefined });
      if (quiet.size) return;
      if (entry === undefined) {
        context.report(
          full === null
            ? { node, messageId: "anonymous", data: { layers: allowedLayers } }
            : {
                node: node.prelude,
                messageId: "layer",
                data: { name: full, layers: allowedLayers },
              },
        );
        silence(node);
        return;
      }
      const covers = (key) => full === key || full.startsWith(`${key}.`);
      for (const [key, files] of Object.entries(layerFiles)) {
        if (!covers(key) || matchesAnyGlob(filename, context.cwd, files)) continue;
        context.report({
          node: node.prelude,
          messageId: "layerFile",
          data: { name: key, files: files.join(", ") },
        });
      }
    }

    return {
      Atrule(node) {
        if (!node.block) return;
        if (node.name.toLowerCase() === "layer") {
          enterLayer(node);
          return;
        }
        if (inAllowedLayer() || quiet.size) return;
        if (outsideAt.has(node.name.toLowerCase())) silence(node);
        else placement(node, `@${node.name}`);
      },
      "Atrule:exit"(node) {
        if (open.at(-1)?.node === node) open.pop();
        quiet.delete(node);
      },
      Rule(node) {
        placement(node, "This style rule");
      },
      "Rule:exit"(node) {
        quiet.delete(node);
      },
      Declaration(node) {
        if (node.important) context.report({ node, messageId: "important" });
      },
    };
  },
};
