import { toFetchHandler, toOpenApi } from "@house-rules/capability";
import { bookingRoutes } from "./delivery/http/routes.js";
import { app } from "./server/composition.js";

export const api = toFetchHandler(app, { prefix: "/api", routes: bookingRoutes });

export const openApi = toOpenApi(bookingRoutes, {
  title: "Hosti API",
  version: "0.0.0",
  prefix: "/api",
  views: app.views,
});
