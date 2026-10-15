import { AccountsIssuer } from "@example/accounts";
import { expect, it } from "@effect/vitest";
import { Config, ConfigProvider, Effect, Option, Redacted } from "effect";
import { signInConfig } from "../composition/sign-in.js";

const settingsFrom = (env: Record<string, string>) =>
  signInConfig.parse(ConfigProvider.fromUnknown(env));

it.effect(
  "the accounts issuer: ACCOUNTS_ISSUER, else APP_ORIGIN's origin, else localhost:PORT",
  () =>
    Effect.gen(function* issuers() {
      const plain = yield* settingsFrom({});
      expect(plain.accounts.issuer).toBe("http://localhost:3000");
      expect(Option.isNone(plain.accounts.signingKey)).toBe(true);
      expect(Option.isNone(plain.mcp)).toBe(true);
      expect((yield* settingsFrom({ PORT: "3300" })).accounts.issuer).toBe("http://localhost:3300");
      const behindProxy = yield* settingsFrom({ APP_ORIGIN: "https://booking.example/app" });
      expect(behindProxy.accounts.issuer).toBe("https://booking.example");
      const named = yield* settingsFrom({
        APP_ORIGIN: "https://booking.example",
        ACCOUNTS_ISSUER: "https://accounts.booking.example",
      });
      expect(named.accounts.issuer).toBe("https://accounts.booking.example");
    }),
);

it.effect("production refuses to start without a signing key, and says how to make one", () =>
  Effect.gen(function* production() {
    const error = yield* Effect.flip(settingsFrom({ NODE_ENV: "production" }));
    expect(error).toBeInstanceOf(Config.ConfigError);
    expect(error.message).toContain("ACCOUNTS_SIGNING_KEY is required when NODE_ENV=production");
    expect(error.message).toContain("crypto.subtle.generateKey");
    const blank = yield* Effect.flip(
      settingsFrom({ NODE_ENV: "production", ACCOUNTS_SIGNING_KEY: "  " }),
    );
    expect(blank).toBeInstanceOf(Config.ConfigError);
  }),
);

it.effect("a signing key is read as a redacted value and never printed", () =>
  Effect.gen(function* redacted() {
    const key = Redacted.value(yield* AccountsIssuer.newSigningKey);
    const settings = yield* settingsFrom({ NODE_ENV: "production", ACCOUNTS_SIGNING_KEY: key });
    const signingKey = Option.getOrThrow(settings.accounts.signingKey);
    expect(Redacted.value(signingKey)).toBe(key);
    expect(String(signingKey)).not.toContain(key);
    expect(JSON.stringify(settings)).not.toContain(key);
  }),
);

it.effect("MCP_AUTH_ISSUER names MCP's own authorization server and nothing else", () =>
  Effect.gen(function* mcp() {
    const settings = yield* settingsFrom({ MCP_AUTH_ISSUER: "https://id.example" });
    expect(settings.mcp).toEqual(Option.some({ issuer: "https://id.example" }));
    expect(settings.accounts.issuer).toBe("http://localhost:3000");
  }),
);
