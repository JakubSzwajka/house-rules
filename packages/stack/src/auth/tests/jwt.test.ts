import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Headers from "effect/http/Headers";
import type * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { exportJWK, generateKeyPair, type JWTPayload, SignJWT } from "jose";
import { AuthProvider } from "../auth-provider.ts";
import { agentFromAct, jwt } from "../jwt.ts";

const issuer = "https://id.example.test";
const secret = "a-shared-secret-of-at-least-thirty-two-bytes";
const rsa = await generateKeyPair("RS256", { extractable: true });
const jwks = { keys: [{ ...(await exportJWK(rsa.publicKey)), kid: "k1", alg: "RS256" }] };

const sign = (
  claims: JWTPayload,
  options: { readonly secret?: string; readonly audience?: string; readonly rsa?: boolean } = {},
) =>
  Effect.promise(() => {
    const token = new SignJWT(claims)
      .setIssuer(issuer)
      .setSubject("ann")
      .setAudience(options.audience ?? "notes-api")
      .setExpirationTime("1m");
    return options.rsa === true
      ? token.setProtectedHeader({ alg: "RS256", kid: "k1" }).sign(rsa.privateKey)
      : token
          .setProtectedHeader({ alg: "HS256" })
          .sign(new TextEncoder().encode(options.secret ?? secret));
  });

const authenticate = (provider: Layer.Layer<AuthProvider>, token: string) =>
  Effect.gen(function* () {
    const auth = yield* AuthProvider;
    return yield* auth.authenticate(Headers.fromInput({ authorization: `Bearer ${token}` }));
  }).pipe(Effect.provide(provider));

describe("jwt", () => {
  const keycloakish = jwt({
    key: { secret },
    issuer,
    audience: "notes-api",
    orgId: (claims) => (typeof claims["tenant"] === "string" ? claims["tenant"] : null),
    roles: (claims) => {
      const access = claims["realm_access"] as
        | { readonly roles?: ReadonlyArray<string> }
        | undefined;
      return access?.roles ?? [];
    },
  });

  it.effect("verifies an HS256 token and maps claims with the given functions", () =>
    Effect.gen(function* () {
      const token = yield* sign({ tenant: "acme", realm_access: { roles: ["editor"] } });
      expect(yield* authenticate(keycloakish, token)).toEqual(
        Option.some({ subject: "ann", orgId: "acme", roles: ["editor"] }),
      );
    }),
  );

  it.effect("refuses another audience, another secret and another algorithm", () =>
    Effect.gen(function* () {
      const refused = [
        yield* sign({}, { audience: "billing-api" }),
        yield* sign({}, { secret: "another-shared-secret-of-thirty-two-bytes" }),
        yield* sign({}, { rsa: true }),
      ];
      for (const token of refused)
        expect(yield* authenticate(keycloakish, token)).toEqual(Option.none());
    }),
  );

  it.effect("reads roles from a roles claim by default, with a local JWKS", () =>
    Effect.gen(function* () {
      const provider = jwt({ key: { jwks }, issuer });
      const token = yield* sign({ roles: ["member", 7, "admin"] }, { rsa: true });
      expect(yield* authenticate(provider, token)).toEqual(
        Option.some({ subject: "ann", orgId: null, roles: ["member", "admin"] }),
      );
    }),
  );

  it.effect("keeps a token with an act claim a person unless the agent option reads it", () =>
    Effect.gen(function* () {
      const delegated = yield* sign({
        roles: ["agent"],
        act: { sub: "agent:claude", name: "Claude" },
      });
      expect(yield* authenticate(jwt({ key: { secret }, issuer }), delegated)).toEqual(
        Option.some({ subject: "ann", orgId: null, roles: ["agent"] }),
      );
      const agents = jwt({ key: { secret }, issuer, agent: agentFromAct });
      expect(yield* authenticate(agents, delegated)).toEqual(
        Option.some({
          subject: "agent:claude",
          orgId: null,
          roles: ["agent"],
          agent: { name: "Claude", forPerson: "ann" },
        }),
      );
      const plain = yield* sign({ roles: ["member"] });
      expect(yield* authenticate(agents, plain)).toEqual(
        Option.some({ subject: "ann", orgId: null, roles: ["member"] }),
      );
      const nameless = yield* sign({ act: { sub: "agent:claude" } });
      expect(yield* authenticate(agents, nameless)).toEqual(
        Option.some({
          subject: "agent:claude",
          orgId: null,
          roles: [],
          agent: { name: "agent:claude", forPerson: "ann" },
        }),
      );
    }),
  );

  it.effect("signs out a token whose act claim is present but malformed", () =>
    Effect.gen(function* () {
      const agents = jwt({ key: { secret }, issuer, agent: agentFromAct });
      const malformed = [
        { sub: "" },
        {},
        { sub: 7 },
        { sub: "claude" },
        { sub: "system:billing" },
        { sub: "agent:" },
        { sub: "agent:claude", name: 7 },
        { sub: "agent:claude", name: "" },
        null,
        "agent:claude",
        ["agent:claude"],
      ];
      for (const act of malformed)
        expect(yield* authenticate(agents, yield* sign({ act }))).toEqual(Option.none());
    }),
  );

  it("tells an absent act claim from a malformed one", () => {
    expect(agentFromAct({ sub: "ann" })).toEqual({ _tag: "None" });
    expect(agentFromAct({ sub: "ann", act: { sub: "" } })._tag).toBe("Malformed");
    expect(agentFromAct({ sub: "agent:x", act: { sub: "agent:claude" } })._tag).toBe("Malformed");
    expect(agentFromAct({ act: { sub: "agent:claude" } })._tag).toBe("Malformed");
    expect(agentFromAct({ sub: "ann", act: { sub: "agent:claude" } })).toEqual({
      _tag: "Agent",
      agent: { id: "agent:claude", name: "agent:claude", forPerson: "ann" },
    });
  });
});
