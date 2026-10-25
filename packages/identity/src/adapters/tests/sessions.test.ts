import { expect, it, layer } from "@effect/vitest";
import { ActorId, UnitOfWork } from "@house-rules/domain";
import { Effect, Layer, Redacted } from "effect";
import { Identity, type ClerkSessionsOptions } from "../../index.js";
import { identityDatabaseTesting, identityWorldsTesting } from "./stores.js";

const actorId = ActorId.make("sessions-owner");
const issuer = "https://clerk.example.com";
for (const name of ["memory", "postgres"] as const) {
  layer(name === "postgres" ? identityDatabaseTesting : Layer.empty)(name, (it) => {
    for (const scenario of ["pagination", "404", "partial", "churn"] as const) {
      it.effect(`Clerk sessions: ${scenario}`, () => {
        const pageSize = scenario === "pagination" ? 2 : 500;
        const sessionCount = scenario === "pagination" ? pageSize + 1 : 2;
        const active = new Set(Array.from({ length: sessionCount }, (_, i) => `sess_${i}`));
        const calls: string[] = [];
        let generation = 0;
        let failed = false;
        const fetch: NonNullable<ClerkSessionsOptions["fetch"]> = (input, init) => {
          const url = new URL(String(input));
          calls.push(`${init?.method} ${url.pathname}${url.search}`);
          // Fail a broken pagination/retry loop without waiting for the test timeout.
          expect(calls.length).toBeLessThanOrEqual(10);
          expect(new Headers(init?.headers).get("authorization")).toBe("Bearer fake-test-key");
          if (init?.method === "GET") {
            expect(url.searchParams.get("user_id")).toBe("user_owner");
            expect(url.searchParams.get("status")).toBe("active");
            expect(url.pathname).toBe("/v1/sessions");
            expect(url.searchParams.get("limit")).toBe(String(pageSize));
            const offset = Number(url.searchParams.get("offset"));
            const data = [...active].slice(offset, offset + pageSize).map((id) => ({ id }));
            return Promise.resolve({
              ok: true,
              status: 200,
              json: () => Promise.resolve({ data }),
            });
          }
          expect(init.method).toBe("POST");
          const id = url.pathname.split("/").at(-2) ?? "";
          expect(url.pathname).toBe(`/v1/sessions/${id}/revoke`);
          expect(active.has(id)).toBe(true);
          const status =
            scenario === "partial" && id === "sess_1" && !failed
              ? 503
              : scenario === "404"
                ? 404
                : 200;
          if (status === 503) failed = true;
          else {
            active.delete(id);
            if (scenario === "churn" && active.size === 0) active.add(`new_${++generation}`);
          }
          return Promise.resolve({ ok: status === 200, status, json: () => Promise.resolve(null) });
        };
        const world = identityWorldsTesting(
          { providers: [] },
          {
            sessions: Identity.clerkSessions({
              issuer,
              secretKey: Redacted.make("fake-test-key"),
              ...(scenario === "pagination" ? { pageSize } : {}),
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
              ended: scenario === "pagination" ? sessionCount : 0,
            });
            expect(yield* identity.endSessions(actorId)).toEqual({ ended: 0 });
            expect(active.size).toBe(0);
          }
          if (scenario === "pagination") {
            const list = "GET /v1/sessions?user_id=user_owner&status=active&limit=2&offset=";
            expect(calls).toEqual([
              `${list}0`,
              `${list}2`,
              "POST /v1/sessions/sess_0/revoke",
              "POST /v1/sessions/sess_1/revoke",
              "POST /v1/sessions/sess_2/revoke",
              `${list}0`,
              `${list}0`,
            ]);
          }
        }).pipe(Effect.provide(world.layer));
      });
    }
  });
}
it.effect.each([0, -1, 1.5, 501, Number.NaN, Number.POSITIVE_INFINITY])(
  "Clerk sessions rejects invalid pageSize %s before fetching",
  (pageSize) =>
    Effect.gen(function* () {
      const failure = yield* Effect.flip(
        Identity.pipe(
          Effect.provide(
            Identity.layerMemory(
              { providers: [] },
              {
                sessions: Identity.clerkSessions({
                  issuer,
                  secretKey: Redacted.make("fake-test-key"),
                  pageSize,
                  fetch: () => {
                    expect.fail("invalid pageSize must fail before fetching");
                  },
                }),
              },
            ),
          ),
        ),
      );
      expect(failure).toMatchObject({
        _tag: "IdentityProviderInvalid",
        kind: "unavailable",
        option: "pageSize",
      });
    }),
);
it.effect("session control without an adapter is unavailable", () =>
  Effect.gen(function* () {
    const identity = yield* Identity;
    expect(yield* Effect.flip(identity.endSessions(actorId))).toMatchObject({
      _tag: "SessionControlUnavailable",
      kind: "unavailable",
    });
  }).pipe(Effect.provide(Identity.layerMemory())),
);
