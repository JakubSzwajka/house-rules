import type { Actor } from "@house-rules/domain";
import { Cause, Context, Effect, Exit, Layer, Option, Schema } from "effect";
import { McpProtocol, McpServer, type Tool, Toolkit } from "effect/ai";
import { HttpRouter } from "effect/http";
import { CallChannel } from "../call/call-facts.ts";
import { requestIdHeader, withRequestId } from "../call/request-id.ts";
import { Refused, type Incoming } from "./caller.ts";
import { CallerScope } from "./caller-scope.ts";
import { type Composition, serveIn } from "./composition.ts";
import type { FetchHandler } from "./mount-check.ts";
import {
  closedFailure,
  inRequest,
  invoke,
  layerFailure,
  logDefect,
  type Outcome,
} from "./invoke.ts";
import { makeTool } from "./tool.ts";
import { internalErrorView, safeViewOf, type View } from "./views.ts";
import type { AnyWay } from "./way-validation.ts";

type Decision =
  | Readonly<{ admitted: true; actor: Actor }>
  | Readonly<{ admitted: false; view: View }>;
type Admission = Decision & Readonly<{ requestId: string }>;
const refusalResponse = (view: View, requestId: string): Response =>
  Response.json(view.body, {
    status: view.status,
    headers: { "cache-control": "no-store", ...view.headers, [requestIdHeader]: requestId },
  }) as Response;

export const makeMcpHandler = <A, E>(
  app: Composition<A, E>,
  way: Extract<AnyWay<A>, { protocol: "mcp" }>,
): FetchHandler => {
  const tools = way.tools.map((tool) => makeTool(tool.feature, tool));
  type DynamicTool = Tool.Tool<
    string,
    {
      parameters: Schema.Codec<unknown>;
      success: Schema.Codec<unknown>;
      failure: typeof Schema.Unknown;
      failureMode: "error";
    }
  >;
  const kit = Toolkit.make(...(tools as unknown as [DynamicTool]));
  const handlers = Object.fromEntries(
    way.tools.map(({ feature }) => [
      feature.name,
      (params: unknown) =>
        Effect.gen(function* () {
          const scope = yield* Effect.serviceOption(CallerScope);
          if (Option.isNone(scope))
            return yield* Effect.die("An MCP tool ran without its request's caller");
          const { requestId, actor, incoming } = scope.value;
          const outcome = yield* serveIn<A, Outcome<unknown, unknown>>(app, {
            ready: (context) =>
              invoke(app, context, feature, {
                way,
                incoming,
                resolved: actor,
                input: Effect.succeed({ value: params, source: "json" }),
                decoded: true,
                channel: "mcp",
                approval: way.mean.approval,
              }).pipe(withRequestId(requestId)),
            failed: (cause) => layerFailure(way.overrides, cause),
            closed: closedFailure(way.overrides),
          }).pipe(withRequestId(requestId));
          if (outcome.ok) return outcome.value;
          return yield* Effect.fail<NonNullable<unknown> | null | undefined>(outcome.view.body);
        }),
    ]),
  );
  const server = McpServer.toolkit(kit).pipe(
    Layer.provide(kit.toLayer(handlers)),
    Layer.provideMerge(
      McpServer.layerHttp({
        name: way.server.name,
        version: way.server.version,
        path: way.path,
        ...(way.allowedOrigins === undefined ? {} : { allowedOrigins: way.allowedOrigins }),
        protocols: [McpProtocol.v2025_11_25, McpProtocol.v2025_06_18, McpProtocol.v2025_03_26],
      }),
    ),
  );
  const { handler, dispose } = HttpRouter.toWebHandler(
    server as unknown as Layer.Layer<never, never, HttpRouter.HttpRouter>,
    { disableLogger: true },
  );
  const resolve = (incoming: Incoming): Effect.Effect<Admission> => {
    const kept = incoming.headers.get(requestIdHeader);
    const refused = (view: View): Decision => ({ admitted: false, view });
    const identify = Effect.gen(function* (): Effect.fn.Return<Decision, never, A> {
      if (!way.resource.configured)
        return refused({
          status: 503,
          body: {
            error: { code: "not_configured", message: "Auth is not configured on this server." },
          },
        });
      if (!/^Bearer\s+\S+$/iu.test(incoming.headers.get("authorization") ?? "")) {
        return refused(
          yield* safeViewOf(
            undefined,
            new Refused({
              status: 401,
              code: "token_missing",
              message: "Send a bearer token.",
              challenge: way.resource.challenge(),
            }),
            true,
          ),
        );
      }
      const exit = yield* Effect.exit(
        way.who.resolve(incoming).pipe(Effect.provideService(CallChannel, "mcp")),
      );
      if (Exit.isSuccess(exit)) return { admitted: true, actor: exit.value };
      const error = Option.getOrUndefined(Cause.findErrorOption(exit.cause));
      if (error === undefined) {
        yield* Effect.logError("MCP Who died", exit.cause);
        return refused(internalErrorView);
      }
      const view = yield* safeViewOf(way.overrides, error, true);
      return refused(
        view.status === 401
          ? {
              ...view,
              headers: {
                ...view.headers,
                "www-authenticate": way.resource.challenge("invalid_token"),
              },
            }
          : view,
      );
    });
    return serveIn<A, readonly [Decision, string]>(app, {
      ready: (context) => identify.pipe(Effect.provideContext(context), inRequest(kept)),
      failed: (cause) =>
        layerFailure(way.overrides, cause).pipe(
          Effect.map((result) => refused(result.ok ? internalErrorView : result.view)),
          inRequest(kept),
        ),
      closed: closedFailure(way.overrides).pipe(
        Effect.map((result) => refused(result.ok ? internalErrorView : result.view)),
        inRequest(kept),
      ),
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logError("MCP admission failed", cause).pipe(
          Effect.as(refused(internalErrorView)),
          inRequest(kept),
        ),
      ),
      Effect.map(([decision, requestId]) => ({ ...decision, requestId })),
    );
  };
  const serve = (request: Request): Promise<Response> => {
    const incoming: Incoming = { headers: request.headers, url: request.url };
    const admitted = resolve(incoming);
    return Effect.runPromise(admitted).then((admission) =>
      admission.admitted
        ? handler(
            request,
            Context.make(CallerScope, {
              incoming,
              actor: admission.actor,
              requestId: admission.requestId,
            }) as Context.Context<never>,
          ).then(
            (response) => {
              response.headers.set(requestIdHeader, admission.requestId);
              return response;
            },
            (error: unknown) =>
              Effect.runPromise(
                logDefect(app, "MCP server failed", Cause.die(error)).pipe(
                  withRequestId(admission.requestId),
                  Effect.as(refusalResponse(internalErrorView, admission.requestId)),
                ),
              ),
          )
        : refusalResponse(admission.view, admission.requestId),
    );
  };
  return Object.assign(serve, { dispose });
};
