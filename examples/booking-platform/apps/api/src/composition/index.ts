import { type Caller, composition, type CurrentActor, type Grant } from "@house-rules/application";
import type { Layer } from "effect";
import { appLayer } from "./app-layer.js";
import { memberCaller } from "./callers.js";
import { bookingViews } from "./views.js";

export type AppServices = Layer.Success<typeof appLayer>;

export const webCaller: Caller<CurrentActor | Grant, AppServices> = memberCaller;

export const app = composition({ layer: appLayer, caller: webCaller, views: bookingViews });

export type ApiComposition = typeof app;
