import { platformForTests } from "@house-rules/domain-postgres";
import * as Domain from "@alchemy.run/domain";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Headers from "effect/http/Headers";
import * as Layer from "effect/Layer";
import * as RpcMiddleware from "effect/rpc/RpcMiddleware";
import * as Schema from "effect/Schema";
import { exportSPKI, generateKeyPair, SignJWT } from "jose";
import {
  type AuthProvider,
  authorOf,
  devTokens,
  Forbidden,
  requirePermission,
  Roles,
  Session,
  SessionLive,
  sessionClient,
} from "../../index.ts";
import { clerk } from "../clerk.ts";

const DeskId = Schema.String.pipe(Schema.brand("DeskId"));
class Greeted extends Domain.Event("Greeted", { by: Schema.String }) {}

class Greet extends Domain.Command("Greet", {
  target: DeskId,
  middleware: [Session],
  events: [Greeted],
  rejects: [Forbidden],
  reply: { by: Schema.String },
}) {}

class Desk extends Domain.Aggregate("Desk", {
  id: DeskId,
  state: Schema.Struct({ by: Schema.String }),
  initial: { by: "" },
  commands: [Greet],
  decide: {
    Greet: Effect.fn(function* () {
      const actor = yield* requirePermission("desks:greet");
      return [new Greeted({ by: authorOf(actor) })];
    }),
  },
  evolve: { Greeted: (_, e) => ({ by: e.by }) },
  reply: { Greet: (s) => s },
}) {}

class Desks extends Domain.Model("Desks", { aggregates: [Desk] }) {}
class DesksApi extends Domain.Api("DesksApi", { model: Desks, commands: ["Greet"] }) {}

const worldWith = (auth: Layer.Layer<AuthProvider>) =>
  SessionLive.pipe(
    Layer.provide(
      Layer.mergeAll(auth, Roles.layer({ greeter: ["desks:greet"], "org:admin": ["desks:greet"] })),
    ),
    Layer.provideMerge(Desks.layer(Layer.empty).pipe(Layer.provide(platformForTests))),
  );

const devWorld = worldWith(
  devTokens({ "ann-token": { subject: "ann", orgId: null, roles: ["greeter"] } }),
);

const withHeaders = (headers: Headers.Input) =>
  RpcMiddleware.layerClient(Session, ({ request, next }) =>
    next({ ...request, headers: Headers.merge(request.headers, Headers.fromInput(headers)) }),
  );

const greet = (client: Layer.Layer<RpcMiddleware.ForClient<Session>>, desk: string) =>
  Effect.flatMap(DesksApi.clientInProcess.pipe(Effect.provide(client)), (api) =>
    api.Greet(DeskId.make(desk)),
  ).pipe(Effect.map(({ reply }) => reply));

describe("SessionLive", () => {
  it.live("signs a dev-token person in from a bearer token or the session cookie", () =>
    Effect.gen(function* () {
      expect(yield* greet(sessionClient("ann-token"), "d-1")).toEqual({ by: "ann" });
      expect(yield* greet(withHeaders({ cookie: "__session=ann-token" }), "d-2")).toEqual({
        by: "ann",
      });
    }).pipe(Effect.scoped, Effect.provide(devWorld)),
  );

  it.live("signs a Clerk organisation admin in and resolves org:admin to permissions", () =>
    Effect.gen(function* () {
      const keys = yield* Effect.promise(() => generateKeyPair("RS256", { extractable: true }));
      const jwtKey = yield* Effect.promise(() => exportSPKI(keys.publicKey));
      const token = yield* Effect.promise(() =>
        new SignJWT({ v: 2, o: { id: "org_1", rol: "admin" } })
          .setProtectedHeader({ alg: "RS256" })
          .setIssuer("https://clerk.example.test")
          .setSubject("user_ann")
          .setExpirationTime("1m")
          .sign(keys.privateKey),
      );
      const reply = yield* greet(withHeaders({ cookie: `__session=${token}` }), "d-4").pipe(
        Effect.scoped,
        Effect.provide(worldWith(clerk({ issuer: "https://clerk.example.test", jwtKey }))),
      );
      expect(reply).toEqual({ by: "user_ann" });
    }),
  );

  it.live("refuses a subject that could pose as a system author", () =>
    Effect.gen(function* () {
      const refused = yield* greet(sessionClient("posing-token"), "d-5").pipe(
        Effect.flip,
        Effect.scoped,
        Effect.provide(
          worldWith(
            devTokens({
              "posing-token": { subject: "system:billing", orgId: null, roles: ["greeter"] },
            }),
          ),
        ),
      );
      expect(refused._tag).toBe("Unauthenticated");
    }),
  );

  it.live("signs an agent in as its own party, with its own roles", () =>
    Effect.gen(function* () {
      const world = worldWith(
        devTokens({
          "claude-token": {
            subject: "claude",
            orgId: null,
            roles: ["greeter"],
            agent: { name: "Claude", forPerson: "ann" },
          },
          "idle-token": {
            subject: "idle",
            orgId: null,
            roles: [],
            agent: { name: "Idle", forPerson: "ann" },
          },
        }),
      );
      const reply = yield* greet(sessionClient("claude-token"), "d-6").pipe(
        Effect.scoped,
        Effect.provide(world),
      );
      expect(reply).toEqual({ by: "claude" });
      const refused = yield* greet(sessionClient("idle-token"), "d-7").pipe(
        Effect.flip,
        Effect.scoped,
        Effect.provide(world),
      );
      expect(refused._tag).toBe("Forbidden");
    }),
  );

  it.live("refuses an agent that poses as a system actor, acts for one or for itself", () =>
    Effect.gen(function* () {
      const agentToken = (subject: string, forPerson: string) => ({
        subject,
        orgId: null,
        roles: ["greeter"],
        agent: { name: "Claude", forPerson },
      });
      const world = worldWith(
        devTokens({
          "posing-agent": agentToken("system:billing", "ann"),
          "for-system": agentToken("claude", "system:billing"),
          "for-itself": agentToken("claude", "claude"),
          "for-nobody": agentToken("claude", ""),
        }),
      );
      for (const token of ["posing-agent", "for-system", "for-itself", "for-nobody"]) {
        const refused = yield* greet(sessionClient(token), `d-${token}`).pipe(
          Effect.flip,
          Effect.scoped,
          Effect.provide(world),
        );
        expect(refused._tag).toBe("Unauthenticated");
      }
    }),
  );
});
