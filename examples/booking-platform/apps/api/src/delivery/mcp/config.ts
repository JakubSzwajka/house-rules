import { type ProtectedResource, protectedResource } from "@house-rules/application";
import { Config } from "effect";

export const mcpPath = "/mcp";

const isHttpUrl = (value: string): boolean => {
  if (!URL.canParse(value)) return false;
  const { protocol } = new URL(value);
  return protocol === "https:" || protocol === "http:";
};

export const mcpResourceOf = (appOrigin: string, issuer: string): ProtectedResource =>
  isHttpUrl(appOrigin) && isHttpUrl(issuer)
    ? protectedResource({
        resource: `${new URL(appOrigin).origin}${mcpPath}`,
        authorizationServers: [issuer],
        resourceName: "Hosti",
      })
    : protectedResource(undefined, mcpPath);

export const mcpResource = Config.all({
  appOrigin: Config.String("APP_ORIGIN").pipe(Config.withDefault("")),
  issuer: Config.String("AUTH_ISSUER").pipe(Config.withDefault("")),
}).pipe(Config.map(({ appOrigin, issuer }) => mcpResourceOf(appOrigin, issuer)));
