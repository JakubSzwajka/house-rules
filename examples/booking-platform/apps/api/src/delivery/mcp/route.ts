import { type ProtectedResource, toMcpHandler } from "@house-rules/application";
import { agentCaller } from "../../composition/callers.js";
import type { ApiComposition } from "../../composition/index.js";
import { mcpPath } from "./config.js";
import { mcpViews } from "./errors.js";
import { mcpTools } from "./tools.js";

export const mcpRoute = (app: ApiComposition, resource: ProtectedResource) =>
  toMcpHandler(app, {
    path: mcpPath,
    name: "booking-example",
    version: "0.0.0",
    caller: agentCaller(resource),
    tools: mcpTools,
    views: mcpViews,
  });
