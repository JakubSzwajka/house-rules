import assert from "node:assert/strict";
import { it } from "node:test";
import { layout } from "../src/dependency-cruiser.cjs";
import { violatedRules } from "./dependency-cruiser-helpers.mjs";

it("application owns event delivery without importing event-log, even type-only", async () => {
  for (const source of [
    "import {Entry} from '@house-rules/event-log';",
    "import type {Entry} from '@house-rules/event-log/contract';",
  ]) {
    const violations = await violatedRules(
      {
        "packages/application/package.json":
          '{"name":"@house-rules/application","exports":"./src/index.ts"}',
        "packages/application/src/index.ts": source,
      },
      layout({ scope: "@acme/" }),
    );
    assert.ok(violations.some(({ rule }) => rule === "application-does-not-import-event-log"));
  }
});
it("event system ways fit the app area and keep normal way import fences", async () => {
  const base = {
    "apps/api/src/ways-in/events/reaction.ts": "export const eventWay = {};",
    "apps/api/src/features/react/index.ts": "export const feature = {};",
  };
  assert.deepEqual(await violatedRules(base, layout({ scope: "@acme/" })), []);
  const violations = await violatedRules(
    {
      ...base,
      "apps/api/src/ways-in/events/reaction.ts": 'import {other} from "../web/way.ts";',
      "apps/api/src/ways-in/web/way.ts": "export const other = {};",
    },
    layout({ scope: "@acme/" }),
  );
  assert.ok(violations.some(({ rule }) => rule === "ways-in-do-not-import-other-ways"));
});
