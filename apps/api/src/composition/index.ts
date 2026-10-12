import { composition } from "@house-rules/capability";
import { Context, Effect } from "effect";
import { appLayer } from "./app-layer.js";
import { bookingViews } from "./views.js";

const visitorCaller = () => {
  // The example has no sign-in, so every visitor holds the root's Grant and the caller adds nothing.
  return Effect.succeed(Context.empty());
};

export const app = composition({ layer: appLayer, caller: visitorCaller, views: bookingViews });
