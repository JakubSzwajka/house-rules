import { assert, it } from "@effect/vitest";
import { Mean } from "@house-rules/application";
import { Effect } from "effect";
import { mcpWay } from "../../mcp/way.ts";
import { partnerWay } from "../../partner/way.ts";
import { webWay } from "../way.ts";

it.effect(
  "ways select browser-confirmed Mean.allow for web, Mean.no for partner and Mean.elicitation for mcp",
  () =>
    Effect.sync(() => {
      assert.strictEqual(webWay.mean, Mean.allow);
      assert.strictEqual(partnerWay.mean, Mean.no);
      assert.strictEqual(mcpWay.mean, Mean.elicitation);
    }),
);
