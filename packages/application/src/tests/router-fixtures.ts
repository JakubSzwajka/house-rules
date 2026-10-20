import { memoryUnitOfWork } from "@house-rules/domain";
import { Effect, Layer } from "effect";
import {
  composition,
  defineWay,
  type Endpoint,
  type AnyEntry,
  type MeanSocket,
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
import { type Fixture, fixtureLayer, testActor } from "./entry-fixtures.ts";

type Options<Entries extends readonly AnyEntry[], E> = Readonly<{
  name?: string;
  path?: `/${string}`;
  who?: WhoSocket;
  mean?: MeanSocket;
  person?: readonly import("@house-rules/domain").Permission[];
  extra?: Layer.Layer<never, E>;
  overrides?: WordingOverrides<WayFailure<Entries>>;
}>;
export const httpFixture = <const Entries extends readonly Fixture<AnyEntry, never>[], E = never>(
  entries: Entries,
  options: Options<Entries, E> &
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
    entries,
    who: options.who ?? { resolve: () => Effect.succeed(testActor) },
    may: May.fixed(entries, options.person ?? entries.flatMap((entry) => entry.closures.person)),
    mean: options.mean ?? Mean.no,
  });
  const runtime = Layer.merge(
    fixtureLayer(entries as readonly Fixture<AnyEntry, never>[]),
    memoryUnitOfWork,
  );
  const layer = extra === undefined ? runtime : Layer.merge(runtime, extra);
  const app = composition({ layer, entries, ways: [way], system: [] });
  const handler = toFetchHandler(app);
  return { app, handler, way, dispose: () => handler.dispose().then(() => app.dispose()) };
};

export const bothFixture = <const Entries extends readonly Fixture<AnyEntry, never>[], E = never>(
  entries: Entries,
  options: Options<Entries, E> & Readonly<{ endpoints: readonly Endpoint[] }>,
) => {
  const who = options.who ?? { resolve: () => Effect.succeed(testActor) };
  const may = May.fixed(
    entries,
    options.person ?? entries.flatMap((entry) => entry.closures.person),
  );
  const http = defineWay({
    name: "web",
    path: "/",
    protocol: "http",
    entries,
    endpoints: options.endpoints,
    who,
    may,
    mean: Mean.no,
    ...(options.overrides === undefined ? {} : { overrides: options.overrides }),
  });
  const mcp = defineWay({
    name: "mcp",
    path: "/mcp",
    protocol: "mcp",
    entries,
    tools: entries.map((entry) => ({
      entry,
      title: entry.node.name,
      idempotent: true,
      openWorld: false,
    })),
    server: { name: "test", version: "1" },
    resource: protectedResource({
      resource: "https://app.example/mcp",
      authorizationServers: ["https://issuer.example"],
    }),
    who,
    may,
    mean: Mean.elicitation,
    ...(options.overrides === undefined ? {} : { overrides: options.overrides }),
  });
  const runtime = Layer.merge(
    fixtureLayer(entries as readonly Fixture<AnyEntry, never>[]),
    memoryUnitOfWork,
  );
  const layer = options.extra === undefined ? runtime : Layer.merge(runtime, options.extra);
  const app = composition({ layer, entries, ways: [http, mcp], system: [] });
  const handler = toFetchHandler(app);
  return { app, handler, dispose: () => handler.dispose().then(() => app.dispose()) };
};

export const mcpFixture = <const Entries extends readonly Fixture<AnyEntry, never>[], E = never>(
  entries: Entries,
  options: Options<Entries, E> &
    Readonly<{
      resource?: ProtectedResource;
      allowedOrigins?: readonly string[];
      tools: readonly Readonly<{
        entry: AnyEntry;
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
    entries,
    server: { name: "test", version: "1" },
    resource:
      options.resource ??
      protectedResource({
        resource: "https://app.example/mcp",
        authorizationServers: ["https://issuer.example"],
      }),
    who: options.who ?? { resolve: () => Effect.succeed(testActor) },
    may: May.fixed(entries, options.person ?? entries.flatMap((entry) => entry.closures.person)),
    mean: options.mean ?? Mean.elicitation,
  });
  const runtime = Layer.merge(
    fixtureLayer(entries as readonly Fixture<AnyEntry, never>[]),
    memoryUnitOfWork,
  );
  const layer = extra === undefined ? runtime : Layer.merge(runtime, extra);
  const app = composition({ layer, entries, ways: [way], system: [] });
  const handler = toFetchHandler(app);
  return { app, handler, way, dispose: () => handler.dispose().then(() => app.dispose()) };
};
