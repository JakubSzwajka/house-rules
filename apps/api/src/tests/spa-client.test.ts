import { afterAll, expect, it } from "@effect/vitest";
import { HttpFailure } from "@house-rules/application";
import { Effect, Layer, Schema } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import { api } from "../main.js";
import { app } from "../composition/index.js";
import { bookingClient } from "../delivery/web/booking-client.js";

afterAll(() => api.dispose().then(app.dispose));

const atOrigin = Layer.effect(
  HttpClient.HttpClient,
  Effect.map(
    HttpClient.HttpClient,
    HttpClient.mapRequest(HttpClientRequest.prependUrl("https://hosti.example")),
  ),
).pipe(Layer.provide(FetchHttpClient.layer));

const inProcess = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.provide(atOrigin),
    Effect.provideService(FetchHttpClient.Fetch, (input, init) =>
      api(new Request(String(input), init) as Request),
    ),
  );

it.effect(
  "the SPA client gets the declared not_found code back through the real fetch handler",
  () =>
    Effect.gen(function* readsMissing() {
      const failure = yield* Effect.flip(
        bookingClient.show_booking({ id: "missing" }).pipe(inProcess),
      );
      expect(Schema.is(HttpFailure)(failure)).toBe(true);
      expect(failure).toMatchObject({
        code: "not_found",
        status: 404,
        body: { error: { code: "not_found", message: "Booking missing was not found." } },
      });
    }),
);
