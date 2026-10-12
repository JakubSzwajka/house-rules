import { Cause, Context, Effect, Exit, Layer, Option, Schema } from "effect";
import { McpProtocol, McpServer, Toolkit } from "effect/unstable/ai";
import { HttpRouter, HttpServerResponse } from "effect/unstable/http";
import { requestIdHeader, withRequestId } from "../call/request-id.ts";
import { toTool } from "../contract/to-tool.ts";
import { elicitationApproval } from "../gates/elicitation-approval.ts";
import type { Caller, Incoming } from "./caller.ts";
import { CallerScope } from "./caller-scope.ts";
import type { Composition } from "./composition.ts";
import type { FetchHandler } from "./fetch-handler.ts";
import { encodeInput } from "./input.ts";
import {
  type AnyFailure,
  type ApprovalOption,
  inRequest,
  invoke,
  type Mountable,
} from "./invoke.ts";
import type { MountCheck } from "./mount-check.ts";
import { defaultViews, safeViewOf, tagOf, type View, type ViewTable } from "./views.ts";

export type McpToolOptions = Readonly<{ title: string; idempotent: boolean; openWorld: boolean }>;

export type McpTool<Cap extends Mountable = Mountable> = Readonly<{
  _tag: "McpTool";
  capability: Cap;
  options: McpToolOptions;
}>;

export const tool = <Cap extends Mountable>(
  capability: Cap,
  options: McpToolOptions,
): McpTool<Cap> => ({ _tag: "McpTool", capability, options });

export type McpHandlerOptions<A, CA, Tools, AdapterViews> = Readonly<{
  tools: Tools;
  path: `/${string}`;
  name: string;
  version: string;
  caller?: Caller<CA, A>;
  views?: AdapterViews;
  approval?: ApprovalOption;
  allowedOrigins?: ReadonlyArray<string>;
}>;

type Admission =
  | Readonly<{ admitted: true; requestId: string; caller: Context.Context<never> }>
  | Readonly<{ admitted: false; requestId: string; view: View }>;

const refusalResponse = (view: View, requestId: string): Response =>
  HttpServerResponse.toWeb(
    HttpServerResponse.jsonUnsafe(view.body, {
      status: view.status,
      headers: { "cache-control": "no-store", ...view.headers, [requestIdHeader]: requestId },
    }),
  );

const withRequestIdHeader = (response: Response, requestId: string): Response => {
  // The router builds this Response itself, so its headers are mutable.
  response.headers.set(requestIdHeader, requestId);
  return response;
};

export const toMcpHandler = <
  A,
  C,
  Views extends ViewTable<C>,
  const Tools extends ReadonlyArray<McpTool>,
  CA = C,
  const AdapterViews extends ViewTable<CA> = Record<never, never>,
>(
  app: Composition<A, C, Views>,
  options: McpHandlerOptions<A, CA, Tools, AdapterViews> &
    MountCheck<Tools[number]["capability"], A, CA, Views & AdapterViews>,
): FetchHandler => {
  const views = { ...defaultViews, ...app.views, ...options.views };
  const caller = (options.caller ?? app.caller) as Caller<never, A>;
  // A tool failure must be a plain object: McpServer sends an Error as its message only.
  const tools = options.tools.map((entry) =>
    toTool(entry.capability.contract, { ...entry.options, failure: Schema.Unknown }),
  );
  const kit = Toolkit.make(...(tools as unknown as [ReturnType<typeof toTool>]));
  const handlers = Object.fromEntries(
    options.tools.map((entry) => [
      entry.capability.contract.name,
      (params: unknown) =>
        Effect.gen(function* mcpTool() {
          const scope = yield* Effect.serviceOption(CallerScope);
          if (Option.isNone(scope)) {
            return yield* Effect.die("An MCP tool ran without its request's caller");
          }
          const outcome = yield* invoke(app, entry.capability, {
            incoming: scope.value.incoming,
            // Toolkit decoded the params with the contract; encode them so every channel decodes once more the same way.
            input: encodeInput(entry.capability.contract, params).pipe(
              Effect.map((value) => ({ value, source: "json" as const })),
            ),
            channel: "mcp",
            caller,
            resolved: scope.value.caller,
            approval: options.approval,
            // The MCP client asks the human, and fails closed when it cannot.
            defaultApproval: elicitationApproval,
            views,
          }).pipe(withRequestId(scope.value.requestId));
          if (outcome.ok) return outcome.value;
          return yield* Effect.fail<AnyFailure>(outcome.view.body);
        }),
    ]),
  );
  const handlerLayer = (
    kit as unknown as { toLayer: (handlers: unknown) => Layer.Layer<never> }
  ).toLayer(handlers);
  const server = McpServer.toolkit(kit).pipe(
    Layer.provide(handlerLayer),
    Layer.provideMerge(
      McpServer.layerHttp({
        name: options.name,
        version: options.version,
        path: options.path,
        protocols: [McpProtocol.v2025_11_25, McpProtocol.v2025_06_18, McpProtocol.v2025_03_26],
        ...(options.allowedOrigins === undefined ? {} : { allowedOrigins: options.allowedOrigins }),
      }),
    ),
  );
  // Its own router: an HTTP handler on the same composition must never answer MCP.
  const { handler, dispose } = HttpRouter.toWebHandler(
    server as unknown as Layer.Layer<never, never, HttpRouter.HttpRouter>,
    { disableLogger: true },
  );
  const admit = (incoming: Incoming): Effect.Effect<Admission> =>
    Effect.gen(function* admitCall() {
      const built = yield* Effect.exit(app.runtime.contextEffect);
      if (Exit.isFailure(built)) {
        yield* Effect.logError("The app layer did not build", built.cause);
        return { admitted: false as const, view: yield* safeViewOf(views, undefined, undefined) };
      }
      return yield* Effect.gen(function* resolveCaller() {
        const exit = yield* Effect.exit(caller(incoming));
        if (Exit.isSuccess(exit)) return { admitted: true as const, caller: exit.value };
        const error = Option.getOrUndefined(Cause.findErrorOption(exit.cause));
        const tag = tagOf(error);
        if (tag === undefined || !Object.hasOwn(views, tag)) {
          yield* Effect.logError("MCP caller failed without a view", exit.cause);
        }
        return { admitted: false as const, view: yield* safeViewOf(views, error, undefined) };
      }).pipe(Effect.provideContext(built.value));
    }).pipe(
      inRequest(incoming.headers.get(requestIdHeader)),
      Effect.map(([admission, requestId]) => ({ ...admission, requestId })),
    );
  const serve = (request: Request): Promise<Response> => {
    const incoming: Incoming = { headers: request.headers, url: request.url };
    // Refuse before McpServer sees the request, so the 401 challenge names resource_metadata.
    return app.runtime.runPromise(admit(incoming)).then((admission) =>
      admission.admitted
        ? handler(
            request,
            Context.make(CallerScope, {
              incoming,
              requestId: admission.requestId,
              caller: admission.caller,
            }) as Context.Context<never>,
          ).then((response) => withRequestIdHeader(response, admission.requestId))
        : refusalResponse(admission.view, admission.requestId),
    );
  };
  return Object.assign(serve, { dispose });
};
