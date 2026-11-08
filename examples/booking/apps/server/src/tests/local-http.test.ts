import { platformForTests } from "@house-rules/domain-postgres";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import { devTokens } from "@house-rules/stack";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as HttpRouter from "effect/http/HttpRouter";
import * as Layer from "effect/Layer";
import { DEV_TOKENS } from "../auth.ts";
import { bookingLive } from "../booking-live.ts";
import { Routes } from "../routes.ts";

const Served = HttpRouter.serve(Routes, { disableLogger: true }).pipe(
  Layer.provide(bookingLive(devTokens(DEV_TOKENS)).pipe(Layer.provide(platformForTests))),
  Layer.provideMerge(NodeHttpServer.layerTest),
);

it.live("the local server answers a command and a view read over plain HTTP", () =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const made = yield* HttpClientRequest.post("/MakeBooking").pipe(
      HttpClientRequest.bearerToken("ann-token"),
      HttpClientRequest.bodyJsonUnsafe({
        target: "http-1",
        input: { guestName: "Grace", amount: 100 },
      }),
      client.execute,
    );
    expect(made.status).toBe(200);
    const receipt = yield* made.json;
    expect(receipt).toMatchObject({ stream: "Booking/http-1", version: 1 });
    const read = yield* HttpClientRequest.get("/MyBookings/ann").pipe(
      HttpClientRequest.bearerToken("ann-token"),
      HttpClientRequest.setUrlParams({ stream: "Booking/http-1", version: "1" }),
      client.execute,
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap((response) => response.json),
    );
    expect(read).toMatchObject({ bookings: [{ bookingId: "http-1", status: "active" }] });
    const anonymous = yield* client.get("/MyBookings/ann");
    expect(anonymous.status).toBe(401);
  }).pipe(Effect.provide(Served)),
);
