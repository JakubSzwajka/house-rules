# MCP adapter

Status: accepted. The reference implementation is Trippy. It first served a read-only MCP server with three tools, and now has nine, five of them writes. Claude Code signed in there end to end over OAuth on 30 Sep 2026.

## Context

Owners want agents to use their apps: read a trip, list bookings, and later change them. An agent can reach an app through MCP, through a CLI, or by scraping the web pages. Each path needs to know who the user is and what that user may see. If every path answers those questions on its own, the answers drift apart, and one path leaks data another path guards.

## Decision

Write each capability once. A module exposes an Effect service whose methods take the acting user as an explicit `Actor` and fail with typed errors. The module checks access to one object itself. Trippy goes further and puts that check inside each SQL statement. Each contract also declares a `permission`, and `implement` checks it with the `Grant` slot before the handler runs. A contract with `needsApproval: true` also asks the `Approval` slot, so a human confirms the call. A use-case in the app yields the `Viewer`, which holds the `Actor`, and calls the module.

Each way in is an adapter. An adapter decides who the `Viewer` is, provides the `Grant` and `Approval` slots for the request, runs a use-case, and maps typed errors to its own response, once. It knows nothing else. The MCP adapter fills `Approval` with `elicitationApproval`, which asks the human through the client's elicitation form and fails closed when the client cannot. An agent never answers its own approval.

```text
  adapter (delivery)           gates (implement)       app use-case    package (module)
  who is calling               may they, do they mean  what to do      may they, on this object

  web page  cookie session ──┐
  MCP tool  OAuth bearer   ──┼─> Viewer(Actor) ─> Grant ─> Approval ─> use-case ─> service method(actor)
  CLI       env credential ──┘   + Grant, Approval                                  checks one object
  (later)                        slots per request

  typed error <── each adapter maps it to its own response, once
```

The MCP adapter has a tool catalogue in the app's delivery layer. A tool is data: a name, a description, an input `Schema`, a read-only or destructive annotation, and a handler that runs an existing use-case. Handlers never touch a module or the database. A CLI adapter would read the same catalogue.

The first tools are read-only. An agent gets the same access as the user has in the app. The module enforces what the `Viewer` may do, not the token, so an agent never gets more than the user has. Every write or destructive tool is annotated as one and needs owner approval before it ships. A token scope is optional and only narrows access. Tools that only the owner may run, or that are hard to undo, such as delete, share, and unshare, stay out of the catalogue until the owner approves each one by name.

Tools return structured data, not prose, and the catalogue stays small, because every tool schema costs context in each agent session. Earendil's [case for MCP in Pi](https://earendil.com/posts/you-said-no-mcp/) asks for the same: tools that return structured data and are found by their description.

A remote MCP server is an OAuth resource server under the [MCP authorization spec 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization). The app's identity provider, Clerk in Trippy, is the authorization server. The app:

1. [ ] answers a call with no valid token with 401 and `WWW-Authenticate` naming `resource_metadata`;
2. [ ] serves `/.well-known/oauth-protected-resource`, naming the authorization server;
3. [ ] checks the token and its audience (RFC 8707), then builds the `Viewer`;
4. [ ] never passes the token on to another service;
5. [ ] refuses every call when auth is not configured.

Clients register with Client ID Metadata Documents where the provider allows it. Dynamic Client Registration opens a registration endpoint anyone can call without a login, so it is the fallback.

The MCP code uses `McpServer`, `Tool`, and `Toolkit` from `effect/unstable/ai`, which ship in the pinned `effect`. `McpServer.layerHttp` serves it over Streamable HTTP, and `HttpRouter.toWebHandler` turns that into one long-lived handler per process. Trippy's route checks the bearer, builds the `Viewer` for that request, and passes it to the handler.

## Consequences

- Access bugs get fixed once, in the module, and every adapter gets the fix.
- A new tool is a catalogue entry and a test, when the use-case already exists.
- The web error view and the MCP error mapper stay separate, so a web message change cannot break an agent.
- The MCP route must be public in the session middleware. It does its own bearer check, and a review has to confirm that check exists.
- Effect's HTTP transport keeps each MCP session in process memory. For the protocol versions clients speak today (2025-03-26 to 2025-11-25) it needs an `Mcp-Session-Id`. A fully stateless mode exists only in the draft 2026-07-28 protocol. So an app runs one replica or routes each client to the same one. A restart gives clients 404, and they start a new session.
- A session holds no user data. The route checks the bearer on every request. Sessions never expire, a small memory leak, because Effect has no public expiry. The catalogue and the auth code know nothing of sessions, so a later move changes only the transport file.
- MCP works on one host, the canonical URL. The metadata and the token audience both name it.
- Clerk copies the RFC 8707 `resource` parameter into the token's `aud` only when "Include audience" is on, and it is off by default. `docs/mcp-clerk.md` lists the settings. A new project runs its end-to-end smoke test before it trusts the setup.
- Two lint rules check part of the pattern. `use-case-is-capability` checks that each use-case file exports one capability. `no-hand-rolled-surface` checks that no tool is built by hand, so each tool comes from a contract through `toTool`. The other rules in `AGENTS.md`, such as the `Viewer`, the access tests, and the bearer check, stay review rules.

## Rejected

- **MCP everywhere, no web pages.** People still use the web app, and both need the same access rules. The adapter split gives both.
- **CLI only.** A CLI works for a local agent with a shell. A hosted agent such as ChatGPT or Claude on the web has no shell, and reaches an app over remote MCP.
- **Wrap the REST API as MCP.** One tool per endpoint gives a long tool list of thin calls, and pays schema tokens for each. Tools here map to use-cases instead.
- **A third-party MCP library by default.** The pinned `effect` already has an MCP server. Another library is one more thing to pin and audit, and it needs owner approval.

## Later

- Write tools, each approved by the owner by name. A hard-to-undo one sets `needsApproval: true`.
- Token scopes that narrow the `Grant` below the user's app role.
- MCP Events. The spec is a draft, and ChatGPT supports only webhook delivery.
- A CLI adapter over the same catalogue.
- A catalogue package, once a second app needs the tools. Apps cannot import apps, so the use-cases move into that package with it.
- A local stdio server. It would read credentials from the environment, and it is out of scope now.
