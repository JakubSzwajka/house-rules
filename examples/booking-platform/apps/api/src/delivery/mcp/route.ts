import { toMcpHandler } from "@house-rules/application";
import type { ApiComposition } from "../../composition/index.js";
import { bearerCaller } from "./auth.js";
import { type McpAuthConfig, mcpPath } from "./config.js";
import { mcpViews } from "./errors.js";
import { mcpTools } from "./tools.js";

export const mcpRoute = (app: ApiComposition, config: McpAuthConfig | undefined) =>
  toMcpHandler(app, {
    path: mcpPath,
    name: "hosti",
    version: "0.0.0",
    caller: bearerCaller(config),
    tools: mcpTools,
    views: mcpViews,
  });
