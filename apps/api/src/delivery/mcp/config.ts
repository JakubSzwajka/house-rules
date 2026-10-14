import { Config } from "effect";

export const mcpPath = "/mcp";

export const metadataPath = "/.well-known/oauth-protected-resource";

export type McpAuthConfig = Readonly<{
  resource: string;
  metadataUrl: string;
  issuer: string;
}>;

const httpUrl = (value: string): URL | undefined => {
  if (!URL.canParse(value)) return undefined;
  const url = new URL(value);
  return url.protocol === "https:" || url.protocol === "http:" ? url : undefined;
};

export const mcpAuthConfigOf = (appOrigin: string, issuer: string): McpAuthConfig | undefined => {
  const origin = httpUrl(appOrigin)?.origin;
  const server = httpUrl(issuer);
  if (origin === undefined || server === undefined) return undefined;
  return {
    resource: `${origin}${mcpPath}`,
    metadataUrl: `${origin}${metadataPath}${mcpPath}`,
    issuer: server.href.replace(/\/$/u, ""),
  };
};

export const mcpAuthConfig = Config.all({
  appOrigin: Config.String("APP_ORIGIN").pipe(Config.withDefault("")),
  issuer: Config.String("MCP_AUTH_ISSUER").pipe(Config.withDefault("")),
}).pipe(Config.map(({ appOrigin, issuer }) => mcpAuthConfigOf(appOrigin, issuer)));
