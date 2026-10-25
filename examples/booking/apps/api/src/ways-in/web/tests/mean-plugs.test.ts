import { assert, it } from "@effect/vitest";
import { Mean } from "@house-rules/application";
import { Effect } from "effect";
import { mcpWay } from "../../mcp/way.ts";
import { webWay } from "../way.ts";

it.effect("ways select browser-confirmed Mean.allow for web and Mean.elicitation for mcp", () =>
  Effect.sync(() => {
    assert.strictEqual(webWay.mean, Mean.allow);
    assert.strictEqual(mcpWay.mean, Mean.elicitation);
  }),
);
