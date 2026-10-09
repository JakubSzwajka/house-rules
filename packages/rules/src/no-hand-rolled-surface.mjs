import { matchesAnyGlob } from "./file-globs.mjs";
import { importOf, staticPropertyName, unwrapExpression } from "./import-bindings.mjs";
import { ruleDocsUrl } from "./rule-docs.mjs";

const SURFACES = [
  { name: "Tool", barrel: /^effect\/unstable\/ai$/u, methods: new Set(["make"]) },
  { name: "Rpc", barrel: /^effect\/unstable\/rpc$/u, methods: new Set(["make"]) },
  {
    name: "HttpApiEndpoint",
    barrel: /^effect\/unstable\/http[^/]*$/u,
    methods: new Set(["make", "get", "post", "put", "patch", "delete", "del", "head", "options"]),
  },
];
const DEFAULT_ALLOW = ["packages/capability/**"];

function moduleSurface(source) {
  const slash = source.lastIndexOf("/");
  const barrel = source.slice(0, slash);
  const name = source.slice(slash + 1);
  return SURFACES.find((surface) => surface.name === name && surface.barrel.test(barrel));
}

// The surface an expression names: `Tool` from the barrel, `* as Tool` from the module, or `Ai.Tool`.
function surfaceOf(expression, sourceCode) {
  const node = unwrapExpression(expression);
  if (node.type === "Identifier") {
    const binding = importOf(node, sourceCode);
    if (binding === null) return undefined;
    if (binding.imported === "*" || binding.imported === "default") {
      return moduleSurface(binding.source);
    }
    return SURFACES.find(
      (surface) => surface.name === binding.imported && surface.barrel.test(binding.source),
    );
  }
  const name = staticPropertyName(node);
  const namespace = node.type === "MemberExpression" ? importOf(node.object, sourceCode) : null;
  if (namespace?.imported !== "*") return undefined;
  return SURFACES.find((surface) => surface.name === name && surface.barrel.test(namespace.source));
}

function surfaceCall(callee, sourceCode) {
  const node = unwrapExpression(callee);
  if (node.type === "Identifier") {
    const binding = importOf(node, sourceCode);
    const surface = binding ? moduleSurface(binding.source) : undefined;
    return surface?.methods.has(binding.imported) ? `${surface.name}.${binding.imported}` : null;
  }
  const method = staticPropertyName(node);
  if (method === undefined) return null;
  const surface = surfaceOf(node.object, sourceCode);
  return surface?.methods.has(method) ? `${surface.name}.${method}` : null;
}

export const noHandRolledSurfaceRule = {
  meta: {
    type: "problem",
    docs: {
      url: ruleDocsUrl("no-hand-rolled-surface"),
      description:
        "Forbid building MCP tools, RPCs, and HTTP API endpoints by hand outside the capability package; build them from a contract.",
    },
    messages: {
      handRolled:
        "{{call}} builds a surface by hand. Define the action once with defineContract and implement from @house-rules/capability, then build the surface from its contract with toTool.",
    },
    schema: [
      {
        type: "object",
        properties: {
          allow: { type: "array", items: { type: "string", minLength: 1 }, uniqueItems: true },
        },
        additionalProperties: false,
      },
    ],
    defaultOptions: [{ allow: DEFAULT_ALLOW }],
  },

  create(context) {
    const filename = context.physicalFilename ?? context.filename;
    const [{ allow }] = context.options;
    if (matchesAnyGlob(filename, context.cwd, allow)) return {};
    const { sourceCode } = context;

    return {
      CallExpression(node) {
        let callee = unwrapExpression(node.callee);
        const viaFunction = staticPropertyName(callee);
        if (viaFunction === "call" || viaFunction === "apply" || viaFunction === "bind") {
          callee = unwrapExpression(callee.object);
        }
        const call = surfaceCall(callee, sourceCode);
        if (call !== null) context.report({ node, messageId: "handRolled", data: { call } });
      },
    };
  },
};
