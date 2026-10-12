import { toFetchHandler } from "@house-rules/capability";
import { bookingRoutes } from "./delivery/http/routes.js";
import { app } from "./server/composition.js";

export const api = toFetchHandler(app, { prefix: "/api", routes: bookingRoutes });
