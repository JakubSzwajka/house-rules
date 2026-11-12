import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Headers from "effect/http/Headers";
import type * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Option from "effect/Option";
import { exportSPKI, generateKeyPair, type JWTPayload, SignJWT } from "jose";
import { AuthProvider } from "../auth-provider.ts";
import { clerk } from "../clerk.ts";
import { agentFromAct } from "../jwt.ts";

const issuer = "https://clerk.example.test";
const app = "https://app.example.test";
const keys = await generateKeyPair("RS256", { extractable: true });
const stranger = await generateKeyPair("RS256");
const jwtKey = await exportSPKI(keys.publicKey);

const token = (
  claims: JWTPayload,
  options: {
    readonly issuer?: string;
    readonly expires?: number | string | null;
    readonly key?: CryptoKey;
  } = {},
) =>
  Effect.promise(() => {
    const signer = new SignJWT({ sid: "sess_1", azp: app, ...claims })
      .setProtectedHeader({ alg: "RS256", kid: "ins_1" })
      .setIssuer(options.issuer ?? issuer)
      .setSubject("user_ann")
      .setIssuedAt()
      .setNotBefore("0s");
    if (options.expires !== null) signer.setExpirationTime(options.expires ?? "1m");
    return signer.sign(options.key ?? keys.privateKey);
  });

const authenticate = (provider: Layer.Layer<AuthProvider>, headers: Headers.Input) =>
  Effect.gen(function* () {
    const auth = yield* AuthProvider;
    return yield* auth.authenticate(Headers.fromInput(headers));
  }).pipe(Effect.provide(provider));

const withWarnings = <A, E>(effect: Effect.Effect<A, E>) => {
  const warnings: Array<string> = [];
  const capture = Logger.make(({ logLevel, message }) => {
    if (logLevel === "Warn") warnings.push(String(message));
  });
  return effect.pipe(
    Effect.map((value) => ({ value, warnings })),
    Effect.provide(Logger.layer([capture])),
  );
};

const bearer = (value: string) => ({ authorization: `Bearer ${value}` });
const provider = clerk({ issuer, jwtKey, authorizedParties: [app] });

describe("clerk", () => {
  it.effect("reads the organisation of a v2 session token from the bearer header", () =>
    Effect.gen(function* () {
      const v2 = yield* token({ v: 2, o: { id: "org_1", rol: "admin", slg: "acme", per: "" } });
      expect(yield* authenticate(provider, bearer(v2))).toEqual(
        Option.some({ subject: "user_ann", orgId: "org_1", roles: ["org:admin"] }),
      );
    }),
  );

  it.effect("reads the organisation of a v1 session token from the __session cookie", () =>
    Effect.gen(function* () {
      const v1 = yield* token({ org_id: "org_1", org_role: "org:member", org_slug: "acme" });
      expect(yield* authenticate(provider, { cookie: `theme=dark; __session=${v1}` })).toEqual(
        Option.some({ subject: "user_ann", orgId: "org_1", roles: ["org:member"] }),
      );
    }),
  );

  it.effect("signs in a person without an active organisation with no roles", () =>
    Effect.gen(function* () {
      const personal = yield* token({ v: 2 });
      expect(yield* authenticate(provider, bearer(personal))).toEqual(
        Option.some({ subject: "user_ann", orgId: null, roles: [] }),
      );
    }),
  );

  it.effect("treats tokens it cannot trust as signed out", () =>
    Effect.gen(function* () {
      const refused = [
        yield* token({ v: 2 }, { expires: 1 }),
        yield* token({ v: 2 }, { issuer: "https://clerk.attacker.test" }),
        yield* token({ v: 2, azp: "https://attacker.test" }),
        yield* token({ v: 2 }, { expires: null }),
        yield* token({ v: 2, azp: undefined }),
        yield* token({ v: 2 }, { key: stranger.privateKey }),
        yield* token({ v: 2, sts: "pending" }),
        "not-a-jwt",
      ];
      for (const value of refused)
        expect(yield* withWarnings(authenticate(provider, bearer(value)))).toEqual({
          value: Option.none(),
          warnings: [],
        });
      expect(yield* authenticate(provider, {})).toEqual(Option.none());
    }),
  );

  it.effect("accepts any azp when no authorized parties are configured", () =>
    Effect.gen(function* () {
      const elsewhere = yield* token({ v: 2, azp: "https://other.example.test" });
      const open = clerk({ issuer, jwtKey });
      expect(Option.isSome(yield* authenticate(open, bearer(elsewhere)))).toBe(true);
      const empty = clerk({ issuer, jwtKey, authorizedParties: [] });
      expect(Option.isSome(yield* authenticate(empty, bearer(elsewhere)))).toBe(true);
      const noParty = yield* token({ v: 2, azp: undefined });
      expect(Option.isSome(yield* authenticate(open, bearer(noParty)))).toBe(true);
    }),
  );

  it.effect("fails closed and warns when the JWKS cannot be fetched", () =>
    Effect.gen(function* () {
      const unreachable = "http://127.0.0.1:9";
      const value = yield* token({ v: 2 }, { issuer: unreachable });
      const { value: result, warnings } = yield* withWarnings(
        authenticate(clerk({ issuer: unreachable }), bearer(value)),
      );
      expect(result).toEqual(Option.none());
      expect(warnings).toHaveLength(1);
    }),
  );

  it.effect("reads an agent only through the agent option", () =>
    Effect.gen(function* () {
      const signed = yield* token({ agent: "agent:claude" });
      const agents = clerk({
        issuer,
        jwtKey,
        agent: (claims) =>
          !Object.hasOwn(claims, "agent")
            ? { _tag: "None" }
            : typeof claims["agent"] === "string" && typeof claims.sub === "string"
              ? {
                  _tag: "Agent",
                  agent: { id: claims["agent"], name: "Claude", forPerson: claims.sub },
                }
              : { _tag: "Malformed", reason: "agent is not a string" },
      });
      expect(yield* authenticate(agents, bearer(signed))).toEqual(
        Option.some({
          subject: "agent:claude",
          orgId: null,
          roles: [],
          agent: { name: "Claude", forPerson: "user_ann" },
        }),
      );
      expect(yield* authenticate(provider, bearer(signed))).toEqual(
        Option.some({ subject: "user_ann", orgId: null, roles: [] }),
      );
      expect(yield* authenticate(agents, bearer(yield* token({})))).toEqual(
        Option.some({ subject: "user_ann", orgId: null, roles: [] }),
      );
      expect(yield* authenticate(agents, bearer(yield* token({ agent: 7 })))).toEqual(
        Option.none(),
      );
    }),
  );

  it.effect("signs out a token whose act claim is malformed when agentFromAct reads it", () =>
    Effect.gen(function* () {
      const agents = clerk({ issuer, jwtKey, agent: agentFromAct });
      const person = yield* token({});
      expect(yield* authenticate(agents, bearer(person))).toEqual(
        Option.some({ subject: "user_ann", orgId: null, roles: [] }),
      );
      for (const act of [{ sub: "" }, {}, { sub: "claude" }, { sub: 7 }, "agent:claude"])
        expect(yield* authenticate(agents, bearer(yield* token({ act })))).toEqual(Option.none());
    }),
  );
});
