import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { it } from "node:test";
import { Linter } from "eslint";
import plugin from "../src/index.mjs";

it("imports completed way factories and their root aggregator without importing builders", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "completed-way-factories-"));
  const files = {
    "features/show/index.ts":
      'import {defineFeature} from "@house-rules/application/contract"; export const show = defineFeature("show", {});',
    "features/first-sign-in/index.ts":
      'import {defineFeature} from "@house-rules/application/contract"; export const firstSignIn = defineFeature("firstSignIn", {start:{kind:"system",reason:"provisioning",startedBy:"identity"}});',
    "ways-in/web/endpoints.ts":
      'import {show} from "../../features/show/index.ts"; export const webFeatures = [show]; export const webApi = {endpoints:{}};',
    "ways-in/web/way.ts":
      'import {defineWay, Mean, type WhoSocket} from "@house-rules/application"; import {webFeatures, webApi} from "./endpoints.ts"; export function createWebWay<R>(who: WhoSocket<R>) { return defineWay({name:"web",protocol:"http",path:"/api",features:webFeatures,endpoints:Object.values(webApi.endpoints),public:[],who,mean:Mean.no}); }',
    "ways-in/web-confirmed/way.ts":
      'import {defineWay as way, Mean} from "@house-rules/application"; import {show} from "../../features/show/index.ts"; export const createWebConfirmedWay = (who) => way({name:"web-confirmed",protocol:"http",path:"/confirmed",features:[show],who,mean:Mean.no});',
    "ways-in/mcp/way.ts":
      'import {defineWay, Mean} from "@house-rules/application"; import {show} from "../../features/show/index.ts"; export const createMcpWay = ({who, resource, allowedOrigins}) => defineWay({name:"mcp",protocol:"mcp",path:"/mcp",features:[show],who,resource,allowedOrigins,mean:Mean.no});',
    "ways-in/hooks/first-sign-in.ts":
      'import {defineWay, Mean} from "@house-rules/application"; import {firstSignIn} from "../../features/first-sign-in/index.ts"; export const createFirstSignInWay = (slot) => defineWay({name:"first-sign-in",protocol:"hook",features:[firstSignIn],slot,mean:Mean.allow});',
    "index.ts":
      'import {createWebWay} from "./ways-in/web/way.ts"; import {createWebConfirmedWay} from "./ways-in/web-confirmed/way.ts"; import {createMcpWay} from "./ways-in/mcp/way.ts"; import {createFirstSignInWay} from "./ways-in/hooks/first-sign-in.ts"; export const createTrainerWays = (sockets) => [{...createWebWay(sockets.webWho), origins:sockets.allowedOrigins}, createWebConfirmedWay(sockets.webWho), createMcpWay({who:sockets.mcpWho,resource:sockets.resource,allowedOrigins:sockets.allowedOrigins}), createFirstSignInWay(sockets.firstSignIn)];',
    "main.ts":
      'import {createTrainerWays} from "./index.ts"; const ways = createTrainerWays(sockets); createApp({ways});',
    "factory-exports.ts": 'export {createWebWay as configuredWeb} from "./ways-in/web/way.ts";',
  };
  const lint = (code, file) =>
    new Linter({ cwd: root })
      .verify(code, plugin.configs.features, { filename: path.join(root, "apps/api/src", file) })
      .filter((m) => m.ruleId === "house-rules/feature-builders" || m.fatal)
      .map((m) => m.messageId ?? m.message);
  try {
    for (const [file, code] of Object.entries(files)) {
      const target = path.join(root, "apps/api/src", file);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, code);
    }
    for (const [file, code] of Object.entries(files)) assert.deepEqual(lint(code, file), [], file);
    for (const code of [
      'import {configuredWeb as configure} from "./factory-exports.ts"; configure(who);',
      'import * as Web from "./ways-in/web/way.ts"; Web.createWebWay(who);',
    ])
      assert.deepEqual(lint(code, "main.ts"), [], code);

    const prelude =
      'import {defineWay} from "@house-rules/application"; import {show} from "../../features/show/index.ts";';
    const options = '{name:"web",protocol:"http",features:[show],who}';
    const forbidden = [
      "export const factory = defineWay;",
      "export {defineWay as factory};",
      "export const factory = () => defineWay;",
      "export function factory() { return defineWay; }",
      "export const factory = defineWay.bind(null);",
      "export const factory = (options) => defineWay(options);",
      "export function factory<T>(options: T) { return defineWay(options); }",
      "export const factory = (...args) => defineWay(...args);",
      "export const factory = (options) => defineWay({...options});",
      'export const factory = (options) => defineWay({name:"web",protocol:options.protocol,features:options.features});',
      `const alias = defineWay; export const factory = (who) => alias(${options});`,
      `export const factory = (who) => defineWay.call(null, ${options});`,
      `export const factory = (who) => defineWay.apply(null, [${options}]);`,
      `export const factory = (who) => [defineWay(${options}), defineWay];`,
      'export const factory = (who) => defineWay({name:"web",protocol:"http",features:[show],who,builder:defineWay});',
    ];
    for (const body of forbidden) {
      const code = prelude + body;
      const file = "ways-in/web/forwarder.ts";
      writeFileSync(path.join(root, "apps/api/src", file), code);
      assert.ok(lint(code, file).length > 0, body);
      assert.deepEqual(
        lint('import {factory} from "./ways-in/web/forwarder.ts"; factory(who);', "main.ts"),
        ["named"],
        body,
      );
    }
    const illegalFeature =
      'import {defineFeature} from "@house-rules/application/contract"; export const factory = () => defineFeature("fake", {});';
    assert.deepEqual(lint(illegalFeature, "ways-in/web/illegal.ts"), ["origin"]);
    for (const body of [
      "export const factory = (options) => defineWay(options);",
      'export const factory = (who) => defineWay({protocol:"http",features:[{}],who});',
    ])
      assert.ok(lint(prelude + body, "ways-in/web/invalid.ts").length > 0, body);
    assert.ok(
      lint(files["ways-in/web/way.ts"], "../../../packages/bridge/src/way.ts").includes("named"),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
