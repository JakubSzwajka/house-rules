import { ruleDocsUrl } from "./rule-docs.mjs";

export const featureBuilderMeta = {
  type: "problem",
  docs: {
    url: ruleDocsUrl("feature-builders"),
    description:
      "Require direct named builders, matching entry-point kinds and folders, statically read-only read-model edges, inline exposures and resolved system starts.",
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
      "Call defineFeature in features/<name>/index.ts and defineReadModel in read-models/<name>/index.ts; keep operation builders outside both.",
    options:
      "Pass builder options inline with no spread, computed keys or getters; pass features inline, once, for May.context and defineWay.",
    system: "Hook, schedule and event ways expose only features with an explicit system start.",
    exposure:
      "Exposures must resolve to this app's defineFeature or defineReadModel in its matching folder, directly or through Features/ReadModels.",
  },
};
