import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import * as Effect from "effect/Effect";
import BookingWorker from "./src/booking-worker.ts";

export default Alchemy.Stack(
  "BookingExample",
  { providers: Cloudflare.providers(), state: Alchemy.localState() },
  Effect.gen(function* () {
    const booking = yield* BookingWorker;
    return { url: booking.url.as<string>() };
  }),
);
