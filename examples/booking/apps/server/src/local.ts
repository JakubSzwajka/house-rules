import { fromEnv } from "@house-rules/domain-postgres";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as HttpRouter from "effect/http/HttpRouter";
import * as Layer from "effect/Layer";
import { AuthFromEnv } from "./auth.ts";
import { bookingLive } from "./booking-live.ts";
import { Routes } from "./routes.ts";

export const BookingLocal = bookingLive(AuthFromEnv).pipe(
  Layer.provide(fromEnv({ schema: "booking" })),
);

const Server = Layer.unwrap(
  Effect.gen(function* () {
    const port = yield* Config.Port("PORT").pipe(Config.withDefault(3000));
    const http = yield* Effect.promise(() => import("node:http"));
    return NodeHttpServer.layer(http.createServer, { port });
  }),
);

HttpRouter.serve(Routes).pipe(
  Layer.provide(BookingLocal),
  Layer.provide(Server),
  Layer.launch,
  NodeRuntime.runMain,
);
