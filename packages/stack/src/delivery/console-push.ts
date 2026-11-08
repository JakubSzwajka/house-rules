import * as Effect from "effect/Effect";
import { Push } from "./push.external.ts";

export const consolePush = Push.toLayer(
  Effect.succeed({
    send: (message) => Effect.logInfo("Push sent", { ttl: message.ttl }),
  }),
);
