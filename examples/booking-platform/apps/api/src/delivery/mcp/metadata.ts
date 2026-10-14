import { type McpAuthConfig, mcpPath, metadataPath } from "./config.js";

export const metadataPaths: ReadonlyArray<string> = [metadataPath, `${metadataPath}${mcpPath}`];

export const protectedResourceMetadata = (config: McpAuthConfig) => ({
  resource: config.resource,
  authorization_servers: [config.issuer],
  bearer_methods_supported: ["header"],
  resource_name: "Hosti",
});

const noStore = { "cache-control": "no-store" };

export const metadataHandler =
  (config: McpAuthConfig | undefined) =>
  (request: Request): Promise<Response> => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return Promise.resolve(
        Response.json(
          { error: { code: "method_not_allowed", message: "Use GET." } },
          { status: 405, headers: { ...noStore, allow: "GET, HEAD" } },
        ),
      );
    }
    if (config === undefined) {
      return Promise.resolve(
        Response.json(
          {
            error: {
              code: "not_configured",
              message: "MCP auth is not configured on this server.",
            },
          },
          { status: 503, headers: noStore },
        ),
      );
    }
    return Promise.resolve(
      Response.json(protectedResourceMetadata(config), {
        headers: { "access-control-allow-origin": "*", "cache-control": "public, max-age=3600" },
      }),
    );
  };
