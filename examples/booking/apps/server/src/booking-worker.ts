import * as Cloudflare from "@alchemy.run/cloudflare";
import * as DomainCloudflare from "@alchemy.run/cloudflare/Domain";
import * as Effect from "effect/Effect";
import * as Etag from "effect/http/Etag";
import * as HttpPlatform from "effect/http/HttpPlatform";
import * as HttpRouter from "effect/http/HttpRouter";
import * as Layer from "effect/Layer";
import { ClerkAuth } from "./auth.ts";
import { bookingLive } from "./booking-live.ts";
import { PlainHttpRoutes, RpcRoutes } from "./routes.ts";

const BookingCloudflare = bookingLive(ClerkAuth).pipe(
  Layer.provideMerge(Layer.mergeAll(HttpPlatform.layer, Etag.layer)),
  Layer.provide(DomainCloudflare.layerDurableObjects()),
);

export default class BookingWorker extends Cloudflare.Worker<BookingWorker>()(
  "BookingWorker",
  { main: import.meta.url },
  Effect.gen(function* () {
    const fetch = yield* HttpRouter.toHttpEffect(Layer.mergeAll(PlainHttpRoutes, RpcRoutes));
    return { fetch };
  }).pipe(Effect.provide(BookingCloudflare)),
) {}
