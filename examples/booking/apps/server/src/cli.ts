import * as Domain from "@alchemy.run/domain";
import { toCli } from "@alchemy.run/domain/Cli";
import { BookingApi } from "@example/booking-domain";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Command from "effect/cli/Command";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Layer from "effect/Layer";

const booking = toCli(BookingApi, {
  name: "booking",
  description: "Make and cancel bookings on the booking server.",
  headers: Config.String("BOOKING_TOKEN").pipe(
    Config.withDefault("ann-token"),
    Effect.map((token) => ({ authorization: `Bearer ${token}` })),
    Effect.orDie,
  ),
});

const Protocol = Layer.unwrap(
  Effect.map(
    Config.String("BOOKING_URL").pipe(Config.withDefault("http://localhost:3000")),
    (url) => Domain.protocolHttp(`${url}/rpc`),
  ),
);

Command.run(booking, { version: "0.0.0" }).pipe(
  Effect.provide(
    Layer.mergeAll(Protocol, NodeServices.layer).pipe(Layer.provide(FetchHttpClient.layer)),
  ),
  NodeRuntime.runMain,
);
