import { expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { AuthJwt, AuthJwtConfigInvalid } from "../index.ts";

it.effect("configuration failures use fixed text, not invalid input or adapter diagnostics", () =>
  Effect.gen(function* () {
    const privateDetail = "private-driver-host-and-query";
    for (const adapter of [
      AuthJwt.layer({ issuer: privateDetail }),
      AuthJwt.layer({ issuer: "https://auth.test", jwksUrl: privateDetail }),
      AuthJwt.clerk({ publishableKey: privateDetail }),
    ]) {
      const error = yield* Layer.build(adapter).pipe(Effect.flip);
      expect(error).toBeInstanceOf(AuthJwtConfigInvalid);
      expect(error.kind).toBe("unavailable");
      expect(error.message).not.toContain(privateDetail);
      expect(error.option.length).toBeGreaterThan(0);
    }
  }).pipe(Effect.scoped),
);
