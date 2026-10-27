import { NodeServices } from "@effect/platform-node";
import { toFetchHandler } from "@house-rules/application";
import { AuthJwtLocal } from "@house-rules/auth-jwt";
import { Identity } from "@house-rules/identity";
import { serve } from "@house-rules/node-host";
import { ConfigProvider, Effect, FileSystem, Layer, Path, Schema } from "effect";
import { createApp, modulePlan } from "../src/composition/app.ts";
import { mcpWho, resourceOf } from "../src/composition/sign-in.ts";
import { firstSignInWay } from "../src/ways-in/hooks/first-sign-in.ts";
import { mcpWay } from "../src/ways-in/mcp/way.ts";
import { nightlyCleanupWay } from "../src/ways-in/schedules/nightly-cleanup.ts";
import { webWay } from "../src/ways-in/web/way.ts";

class ProofSetupInvalid extends Schema.TaggedError<ProofSetupInvalid>()("ProofSetupInvalid", {
  message: Schema.String,
}) {}

await Effect.runPromise(
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const argument = process.argv[2];
    if (argument === undefined || !path.isAbsolute(argument))
      return yield* new ProofSetupInvalid({
        message: "Pass an absolute existing proof directory outside the repository.",
      });
    const root = yield* fs.realPath(
      yield* path.fromFileUrl(new URL("../../../../../", import.meta.url)),
    );
    const directory = yield* fs.realPath(argument);
    const relative = path.relative(root, directory);
    if (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
      return yield* new ProofSetupInvalid({
        message: "Proof state must stay outside the repository.",
      });
    if (webWay.protocol !== "http" || mcpWay.protocol !== "mcp")
      return yield* new ProofSetupInvalid({ message: "Expected the booking HTTP and MCP ways." });

    const web = webWay;
    const mcp = mcpWay;
    let app: ReturnType<typeof createApp> | undefined;
    let router: ReturnType<typeof toFetchHandler> | undefined;
    const host = yield* Effect.promise(() =>
      serve(
        (request) => router?.(request) ?? Promise.resolve(new Response(null, { status: 503 })),
        {
          port: 0,
          hostname: "127.0.0.1",
          handleSignals: true,
          onClose: () => (router?.dispose() ?? Promise.resolve()).then(() => app?.dispose()),
        },
      ),
    );
    yield* Effect.gen(function* () {
      const origin = host.url.origin;
      const issuer = "https://web.invalid";
      const resource = resourceOf(origin, issuer);
      const config = ConfigProvider.layer(
        ConfigProvider.fromUnknown({ STORAGE: "memory", NODE_ENV: "test" }),
      );
      const signer = yield* AuthJwtLocal.make({ issuer, audience: `${origin}/mcp` }).pipe(
        Effect.provide(config),
      );
      const plan = modulePlan({
        identity: { providers: [Identity.oidc({ issuer, jwks: signer.jwks })] },
      });
      app = createApp(
        [
          { ...web, origins: [origin] },
          { ...mcp, resource, who: mcpWho(resource) },
          firstSignInWay,
          nightlyCleanupWay,
        ],
        { modules: { ...plan, layer: plan.layer.pipe(Layer.provideMerge(config)) } },
      );
      yield* app.runtime.contextEffect;
      const tokens = Object.fromEntries(
        yield* Effect.forEach(["alice", "bob"], (sub) =>
          signer.issue({ sub }).pipe(Effect.map((token) => [sub, token] as const)),
        ),
      );
      router = toFetchHandler(app);
      yield* fs.writeFileString(path.join(directory, "credentials.json"), JSON.stringify(tokens), {
        mode: 0o600,
        flag: "wx",
      });
      yield* fs.writeFileString(
        path.join(directory, "run.json"),
        JSON.stringify({ origin, pid: process.pid }),
        { mode: 0o600, flag: "wx" },
      );
      yield* Effect.log(`Booking proof ready at ${origin}; state saved in ${directory}`);
    }).pipe(Effect.onError(() => Effect.promise(() => host.close())));
  }).pipe(Effect.provide(NodeServices.layer)),
);
