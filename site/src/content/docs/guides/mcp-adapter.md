---
title: The MCP adapter
description: How agents call an app's use-cases over MCP, with OAuth, a small tool catalogue, and access that never exceeds the user's.
sidebar:
  order: 8
---

An agent reaches an app the same way a web page does: through an adapter that runs a use-case. The MCP adapter decides who the caller is, provides the gates, runs one use-case per tool, and maps its errors. It holds no business logic and no access rule.

```text
MCP tool  OAuth bearer ─> Viewer(Actor) ─> Grant ─> Approval ─> use-case ─> service method(actor)
web page  cookie       ─┘                                                     checks one object

typed error <── each adapter maps it to its own response, once
```

The decision record is [`docs/mcp-adapter.md`](../../../../../docs/mcp-adapter.md). The [add-an-mcp-tool](../skills/add-an-mcp-tool.md) skill walks through adding a tool. The reference app is Trippy, which serves nine tools, five of them writes.

## A tool is one catalogue entry

A tool lives in the app's delivery layer, such as `src/delivery/mcp/tools.ts`. Build it from the use-case's contract with `toTool`. The contract gives the name, description, input schema, and the read-only and destructive annotations. The entry adds a title and the `idempotent` and `openWorld` hints. Its handler runs the capability, never a module service or the database.

## Rules for the catalogue

1. [ ] The first tools an app exposes are read-only.
2. [ ] A write or destructive tool is annotated as one, and the owner approves it before it ships.
3. [ ] Delete, share, unshare, and other owner-only or hard-to-undo tools stay out until the owner approves each one by name. Their contracts set `needsApproval: true`.
4. [ ] Each tool does one job and returns structured data. Text a user wrote goes out as a data field, never as instructions to the model.
5. [ ] Every tool has a test with a fake `Viewer`, including one that proves user B cannot read user A's data through it.

## OAuth

A remote MCP endpoint is an OAuth resource server under the [MCP authorization spec 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization). The identity provider is the authorization server.

| The endpoint must | Tested |
| --- | --- |
| answer a call with no valid token with 401 and `WWW-Authenticate` naming `resource_metadata` | yes |
| serve `/.well-known/oauth-protected-resource`, naming the authorization server | yes |
| check the token and its audience (RFC 8707) before it builds the `Viewer` | |
| never pass the token on to another service | |
| refuse every call when auth is not configured | yes |

[`docs/mcp-clerk.md`](../../../../../docs/mcp-clerk.md) is the checklist for Clerk as the identity provider.

## Access never grows

An agent gets the same access as the user has in the app. The module enforces what the `Viewer` may do, so a token never grants more than the user has. A token scope is optional and only narrows access.
