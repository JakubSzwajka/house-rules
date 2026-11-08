import { BookingApi } from "@example/booking-domain";
import * as DomainAi from "@alchemy.run/domain/Ai";
import * as DomainHttp from "@alchemy.run/domain/Http";
import { McpProtocol, McpServer } from "effect/ai";
import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as HttpRouter from "effect/http/HttpRouter";
import * as Layer from "effect/Layer";

export const BookingHttp = DomainHttp.toHttpApi(BookingApi);

export const PlainHttpRoutes = HttpApiBuilder.layer(BookingHttp.api, {
  openapiPath: "/openapi.json",
}).pipe(Layer.provide(BookingHttp.layer));

export const RpcRoutes = Layer.unwrap(
  Effect.gen(function* () {
    const api = yield* BookingApi;
    return HttpRouter.add("*", "/rpc", api.fetch);
  }),
);

export const McpRoutes = DomainAi.toMcp(BookingApi).pipe(
  Layer.provide(
    McpServer.layerHttp({
      name: "booking",
      version: "0.0.0",
      path: "/mcp",
      protocols: [McpProtocol.v2025_11_25],
    }),
  ),
);

export const Routes = Layer.mergeAll(PlainHttpRoutes, RpcRoutes, McpRoutes);
