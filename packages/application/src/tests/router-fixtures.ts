import { memoryUnitOfWork } from "@house-rules/domain";
import { Effect, Layer } from "effect";
import {
  composition,
  defineWay,
  type Endpoint,
  type AnyFeature,
  type MeanSocket,
  type MaySocket,
  May,
  Mean,
  protectedResource,
  type ProtectedResource,
  toFetchHandler,
  type WhoSocket,
  type WayFailure,
  type WordingOverrides,
  type CorsOptions,
  type SessionOptions,
} from "../index.ts";
import { type Fixture, fixtureLayer, testActor } from "./execution-fixtures.ts";

type Options<Features extends readonly AnyFeature[], E> = Readonly<{
  name?: string;
  path?: `/${string}`;
  who?: WhoSocket;
  mean?: MeanSocket;
  person?: readonly import("@house-rules/domain").Permission[];
  may?: MaySocket<unknown>;
  extra?: Layer.Layer<never, E>;
  overrides?: WordingOverrides<WayFailure<Features>>;
}>;
export const httpFixture = <
  const Features extends readonly Fixture<AnyFeature, never>[],
  E = never,
>(
  features: Features,
  options: Options<Features, E> &
    Readonly<{
      endpoints: readonly Endpoint[];
      cors?: CorsOptions;
      origins?: readonly string[];
      session?: SessionOptions;
      maxBodyBytes?: number;
    }>,
) => {
  const { extra, ...rest } = options;
  const way = defineWay({
    ...rest,
    name: options.name ?? "web",
    path: options.path ?? "/",
    protocol: "http",
    features,
    who: options.who ?? { resolve: () => Effect.succeed(testActor) },
    mean: options.mean ?? Mean.no,
  });
  const runtime = Layer.merge(
    fixtureLayer(features as readonly Fixture<AnyFeature, never>[]),
    memoryUnitOfWork,
  );
  const layer = extra === undefined ? runtime : Layer.merge(runtime, extra);
  const app = composition({
    layer,
    features: features,
    ways: [way],
    may:
      options.may ??
      May.fixed(options.person ?? features.flatMap((feature) => feature.closures.person)),
    system: [],
  });
  const handler = toFetchHandler(app);
  return { app, handler, way, dispose: () => handler.dispose().then(() => app.dispose()) };
};

export const bothFixture = <
  const Features extends readonly Fixture<AnyFeature, never>[],
  E = never,
>(
  features: Features,
  options: Options<Features, E> & Readonly<{ endpoints: readonly Endpoint[] }>,
) => {
  const who = options.who ?? { resolve: () => Effect.succeed(testActor) };
  const may =
    options.may ??
    May.fixed(options.person ?? features.flatMap((feature) => feature.closures.person));
  const http = defineWay({
    name: "web",
    path: "/",
    protocol: "http",
    features,
    endpoints: options.endpoints,
    who,
    mean: Mean.no,
    ...(options.overrides === undefined ? {} : { overrides: options.overrides }),
  });
  const mcp = defineWay({
    name: "mcp",
    path: "/mcp",
    protocol: "mcp",
    features,
    tools: features.map((feature) => ({
      feature,
      title: feature.name,
      idempotent: true,
      openWorld: false,
    })),
    server: { name: "test", version: "1" },
    resource: protectedResource({
      resource: "https://app.example/mcp",
      authorizationServers: ["https://issuer.example"],
    }),
    who,
    mean: Mean.elicitation,
    ...(options.overrides === undefined ? {} : { overrides: options.overrides }),
  });
  const runtime = Layer.merge(
    fixtureLayer(features as readonly Fixture<AnyFeature, never>[]),
    memoryUnitOfWork,
  );
  const layer = options.extra === undefined ? runtime : Layer.merge(runtime, options.extra);
  const app = composition({ layer, features: features, ways: [http, mcp], may, system: [] });
  const handler = toFetchHandler(app);
  return { app, handler, dispose: () => handler.dispose().then(() => app.dispose()) };
};

export const mcpFixture = <const Features extends readonly Fixture<AnyFeature, never>[], E = never>(
  features: Features,
  options: Options<Features, E> &
    Readonly<{
      resource?: ProtectedResource;
      allowedOrigins?: readonly string[];
      tools: readonly Readonly<{
        feature: AnyFeature;
        title: string;
        idempotent: boolean;
        openWorld: boolean;
      }>[];
    }>,
) => {
  const { extra, ...rest } = options;
  const way = defineWay({
    ...rest,
    name: options.name ?? "mcp",
    path: options.path ?? "/mcp",
    protocol: "mcp",
    features,
    server: { name: "test", version: "1" },
    resource:
      options.resource ??
      protectedResource({
        resource: "https://app.example/mcp",
        authorizationServers: ["https://issuer.example"],
      }),
    who: options.who ?? { resolve: () => Effect.succeed(testActor) },
    mean: options.mean ?? Mean.elicitation,
  });
  const runtime = Layer.merge(
    fixtureLayer(features as readonly Fixture<AnyFeature, never>[]),
    memoryUnitOfWork,
  );
  const layer = extra === undefined ? runtime : Layer.merge(runtime, extra);
  const app = composition({
    layer,
    features: features,
    ways: [way],
    may:
      options.may ??
      May.fixed(options.person ?? features.flatMap((feature) => feature.closures.person)),
    system: [],
  });
  const handler = toFetchHandler(app);
  return { app, handler, way, dispose: () => handler.dispose().then(() => app.dispose()) };
};
