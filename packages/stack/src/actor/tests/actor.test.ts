import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import {
  ActedFor,
  actingFor,
  agent,
  attributionOf,
  authorOf,
  partyOf,
  person,
  system,
} from "../../index.ts";
import { Actor, AgentId, PersonId } from "../actor.ts";

const ann = person("ann", { orgId: "acme" });
const claude = agent("agent:claude", "ann", {
  name: "Claude",
  orgId: "acme",
  permissions: ["x:y"],
});
const billing = system("billing");

describe("Actor", () => {
  it("names the author, the party and the person each actor acts for", () => {
    expect([ann, claude, billing].map(authorOf)).toEqual(["ann", "agent:claude", "system:billing"]);
    expect([ann, claude, billing].map(partyOf)).toEqual(["ann", "agent:claude", null]);
    expect([ann, claude, billing].map(actingFor)).toEqual(["ann", "ann", null]);
  });

  it("attributes a change to its author and, for an agent, to the person it acts for", () => {
    expect([ann, claude, billing].map(attributionOf)).toEqual([
      { by: "ann", for: null },
      { by: "agent:claude", for: "ann" },
      { by: "system:billing", for: null },
    ]);
  });

  it.effect("decodes a missing for as null and refuses an agent id in it", () =>
    Effect.gen(function* () {
      const Recorded = Schema.Struct({ by: Schema.String, for: ActedFor });
      expect(yield* Schema.decodeEffect(Recorded)({ by: "ann" })).toEqual({
        by: "ann",
        for: null,
      });
      const refused = yield* Schema.decodeEffect(Recorded)({
        by: "agent:claude",
        for: "agent:other",
      }).pipe(Effect.flip);
      expect(refused._tag).toBe("SchemaError");
    }),
  );

  it("names an agent by its id when no name is given", () => {
    expect(agent("agent:claude", "ann")).toEqual({
      _tag: "Agent",
      id: "agent:claude",
      name: "agent:claude",
      forPerson: "ann",
      orgId: null,
      roles: [],
      permissions: [],
    });
  });

  it("keeps agent ids and person ids apart by the agent: prefix", () => {
    expect(["agent:claude", "agent:a"].every(Schema.is(AgentId))).toBe(true);
    expect(["claude", "agent:", "ann", "system:billing", ""].some(Schema.is(AgentId))).toBe(false);
    expect(["ann", "user_2x", "agentsmith"].every(Schema.is(PersonId))).toBe(true);
    expect(["agent:claude", "agent:"].some(Schema.is(PersonId))).toBe(false);
    expect(() => agent("claude", "ann")).toThrow();
    expect(() => agent("agent:claude", "agent:other")).toThrow();
    expect(() => person("agent:claude")).toThrow();
  });

  it.effect("decodes an agent as an actor", () =>
    Effect.gen(function* () {
      expect(yield* Schema.decodeEffect(Actor)(claude)).toEqual(claude);
    }),
  );
});
