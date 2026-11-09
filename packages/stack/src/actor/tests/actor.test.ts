import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { actingFor, agent, authorOf, partyOf, person, system } from "../../index.ts";
import { Actor } from "../actor.ts";

const ann = person("ann", { orgId: "acme" });
const claude = agent("claude", "ann", { name: "Claude", orgId: "acme", permissions: ["x:y"] });
const billing = system("billing");

describe("Actor", () => {
  it("names the author, the party and the person each actor acts for", () => {
    expect([ann, claude, billing].map(authorOf)).toEqual(["ann", "claude", "system:billing"]);
    expect([ann, claude, billing].map(partyOf)).toEqual(["ann", "claude", null]);
    expect([ann, claude, billing].map(actingFor)).toEqual(["ann", "ann", null]);
  });

  it("names an agent by its id when no name is given", () => {
    expect(agent("claude", "ann")).toEqual({
      _tag: "Agent",
      id: "claude",
      name: "claude",
      forPerson: "ann",
      orgId: null,
      roles: [],
      permissions: [],
    });
  });

  it.effect("decodes an agent as an actor", () =>
    Effect.gen(function* () {
      expect(yield* Schema.decodeEffect(Actor)(claude)).toEqual(claude);
    }),
  );
});
