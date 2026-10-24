import { expect, it } from "@effect/vitest";
import { ActorId, UnitOfWork } from "@house-rules/domain";
import { Effect, Redacted } from "effect";
import { Identity, type ClerkSessionsOptions } from "../../index.js";
import { identityWorldsTesting } from "./stores.js";

const actorId = ActorId.make("sessions-owner");
const issuer = "https://clerk.example.com";
for (const name of ["memory", "postgres"] as const) {
  for (const scenario of ["pagination", "404", "partial", "churn"] as const) {
    it.effect(`${name} Clerk sessions: ${scenario}`, () => {
      const active = new Set(
        Array.from({ length: scenario === "pagination" ? 501 : 2 }, (_, i) => `sess_${i}`),
      );
      const calls: string[] = [];
      let generation = 0;
      let failed = false;
      const fetch: NonNullable<ClerkSessionsOptions["fetch"]> = (input, init) => {
        const url = new URL(String(input));
        calls.push(`${init?.method} ${url.pathname}${url.search}`);
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer fake-test-key");
        if (init?.method === "GET") {
          expect(url.searchParams.get("user_id")).toBe("user_owner");
          expect(url.searchParams.get("status")).toBe("active");
          expect(url.searchParams.get("limit")).toBe("500");
          const offset = Number(url.searchParams.get("offset"));
          const data = [...active].slice(offset, offset + 500).map((id) => ({ id }));
          return Promise.resolve(Response.json({ data }));
        }
        const id = url.pathname.split("/").at(-2) ?? "";
        if (scenario === "partial" && id === "sess_1" && !failed) {
          failed = true;
          return Promise.resolve(new Response(null, { status: 503 }));
        }
        active.delete(id);
        if (scenario === "churn" && active.size === 0) active.add(`new_${++generation}`);
        return Promise.resolve(new Response(null, { status: scenario === "404" ? 404 : 200 }));
      };
      const world = identityWorldsTesting(
        { providers: [] },
        {
          sessions: Identity.clerkSessions({
            issuer,
            secretKey: Redacted.make("fake-test-key"),
            fetch,
          }),
        },
      )[name === "postgres" ? 0 : 1];
      return Effect.gen(function* () {
        const identity = yield* Identity;
        yield* UnitOfWork.atomic(
          Effect.gen(function* () {
            yield* identity.bind({ issuer, subject: "user_owner" }, actorId);
            yield* identity.bind(
              { issuer: "https://unrelated.example", subject: "user_ignored" },
              actorId,
            );
          }),
        );
        if (scenario === "partial") {
          expect(yield* Effect.flip(identity.endSessions(actorId))).toMatchObject({
            _tag: "SessionsPartlyEnded",
            ended: 1,
            remaining: 1,
          });
          expect([...active]).toEqual(["sess_1"]);
          expect(yield* identity.endSessions(actorId)).toEqual({ ended: 1 });
        } else if (scenario === "churn") {
          expect(yield* Effect.flip(identity.endSessions(actorId))).toMatchObject({
            _tag: "SessionsPartlyEnded",
            ended: 4,
            remaining: 1,
          });
        } else {
          expect(yield* identity.endSessions(actorId)).toEqual({
            ended: scenario === "pagination" ? 501 : 0,
          });
          expect(yield* identity.endSessions(actorId)).toEqual({ ended: 0 });
          expect(active.size).toBe(0);
        }
        if (scenario === "pagination") {
          expect(calls[0]).toContain("offset=0");
          expect(calls[1]).toContain("offset=500");
          expect(calls[2]).toContain("POST");
        }
      }).pipe(Effect.provide(world.layer));
    });
  }
}
it.effect("session control without an adapter is unavailable", () =>
  Effect.gen(function* () {
    const identity = yield* Identity;
    expect(yield* Effect.flip(identity.endSessions(actorId))).toMatchObject({
      _tag: "SessionControlUnavailable",
      kind: "unavailable",
    });
  }).pipe(Effect.provide(Identity.layerMemory())),
);
