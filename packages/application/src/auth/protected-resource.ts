import { HttpServerResponse } from "effect/http";

export const protectedResourceMetadataPath = "/.well-known/oauth-protected-resource";

export type ProtectedResourceOptions = Readonly<{
  resource: string;
  authorizationServers: ReadonlyArray<string>;
  resourceName?: string;
}>;

export type ProtectedResourceMetadata = Readonly<{
  resource: string;
  authorization_servers: ReadonlyArray<string>;
  bearer_methods_supported: ReadonlyArray<string>;
  resource_name?: string;
}>;

export type ChallengeError = "invalid_request" | "invalid_token" | "insufficient_scope";

type Served = Readonly<{
  paths: ReadonlyArray<string>;
  handler: (request: Request) => Promise<Response>;
}>;

export type ProtectedResource =
  | (Served &
      Readonly<{
        configured: true;
        metadata: ProtectedResourceMetadata;
        metadataUrl: string;
        challenge: (error?: ChallengeError) => string;
      }>)
  | (Served & Readonly<{ configured: false }>);

type Configured = Extract<ProtectedResource, { configured: true }>;
type Unconfigured = Extract<ProtectedResource, { configured: false }>;

const noStore = { "cache-control": "no-store" };

const httpUrl = (value: string, what: string): URL => {
  const url = URL.canParse(value) ? new URL(value) : undefined;
  if (url === undefined || (url.protocol !== "https:" && url.protocol !== "http:")) {
    throw new TypeError(`protectedResource: ${what} must be an absolute http(s) URL`);
  }
  return url;
};

const resourcePathOf = (pathname: string): string => pathname.replace(/\/+$/u, "");

const pathsFor = (resourcePath: string): ReadonlyArray<string> =>
  resourcePath === ""
    ? [protectedResourceMetadataPath]
    : [protectedResourceMetadataPath, `${protectedResourceMetadataPath}${resourcePath}`];

const quoted = (value: string) => `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;

type HeaderRecord = Readonly<Record<string, string>>;

const answer = (request: Request, status: number, body: unknown, headers: HeaderRecord): Response =>
  HttpServerResponse.toWeb(
    request.method === "HEAD"
      ? HttpServerResponse.empty({
          status,
          headers: { ...headers, "content-type": "application/json" },
        })
      : HttpServerResponse.jsonUnsafe(body, { status, headers }),
  );

const methodNotAllowed = (request: Request) =>
  answer(
    request,
    405,
    { error: { code: "method_not_allowed", message: "Use GET." } },
    { ...noStore, allow: "GET, HEAD" },
  );

const notConfigured = (request: Request) =>
  answer(
    request,
    503,
    { error: { code: "not_configured", message: "Auth is not configured on this server." } },
    noStore,
  );

const isRead = (request: Request) => request.method === "GET" || request.method === "HEAD";

export function protectedResource(
  options: ProtectedResourceOptions,
  unconfiguredResourcePath?: string,
): Configured;
export function protectedResource(
  options: undefined,
  unconfiguredResourcePath?: string,
): Unconfigured;
export function protectedResource(
  options: ProtectedResourceOptions | undefined,
  unconfiguredResourcePath?: string,
): ProtectedResource;
export function protectedResource(
  options: ProtectedResourceOptions | undefined,
  unconfiguredResourcePath = "",
): ProtectedResource {
  if (options === undefined) {
    return {
      configured: false,
      paths: pathsFor(resourcePathOf(unconfiguredResourcePath)),
      handler: (request) =>
        Promise.resolve(isRead(request) ? notConfigured(request) : methodNotAllowed(request)),
    };
  }
  const resource = httpUrl(options.resource, "resource");
  if (options.authorizationServers.length === 0) {
    throw new TypeError("protectedResource: name at least one authorization server");
  }
  // Issuers are compared as exact strings, so each one is validated and then kept as given.
  const authorizationServers = options.authorizationServers.map((server) => {
    httpUrl(server, "each authorization server");
    return server;
  });
  const resourcePath = resourcePathOf(resource.pathname);
  const metadataUrl = `${resource.origin}${protectedResourceMetadataPath}${resourcePath}`;
  const metadata: ProtectedResourceMetadata = {
    resource: options.resource,
    authorization_servers: authorizationServers,
    bearer_methods_supported: ["header"],
    ...(options.resourceName === undefined ? {} : { resource_name: options.resourceName }),
  };
  return {
    configured: true,
    paths: pathsFor(resourcePath),
    metadata,
    metadataUrl,
    challenge: (error) =>
      `Bearer ${[
        ...(error === undefined ? [] : [`error=${quoted(error)}`]),
        `resource_metadata=${quoted(metadataUrl)}`,
      ].join(", ")}`,
    handler: (request) =>
      Promise.resolve(
        isRead(request)
          ? answer(request, 200, metadata, {
              "access-control-allow-origin": "*",
              "cache-control": "public, max-age=3600",
            })
          : methodNotAllowed(request),
      ),
  };
}
