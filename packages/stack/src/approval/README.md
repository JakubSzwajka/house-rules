# Approval

Some commands need a human yes. When an AI agent acts for a person (`actor.via === "agent"`), `ApprovalGate` refuses such a command with `ApprovalRequired` (403), unless the app's approval policy allows it.

```ts
class EmptyVault extends Domain.Command("EmptyVault", {
  target: VaultId,
  middleware: [ApprovalGate, Session],
  events: [VaultEmptied],
  rejects: [Forbidden],
}) {}

const Live = Layer.mergeAll(SessionLive, Approval.denyAgents);
```

| Layer | Decision |
| --- | --- |
| `Approval.denyAgents` | the default: a person acting directly passes, the same person through an agent is refused |
| `Approval.allowAll` | every authenticated actor passes |
| `Approval.policy(({ command, actor }) => boolean)` | the app decides from the command name and the actor |

## List it before Session

In beta.85 the RPC server wraps each middleware around the previous one, so the **last** entry runs first, although Alchemy's docs say the first does. `ApprovalGate` reads the `CurrentActor` that `Session` provides, so it must be inside `Session`: `[ApprovalGate, Session]`. Listed the other way it sees no actor and refuses everyone (fail closed, with a warning in the log). A test pins this order.

## Why a middleware and not `requireApproval` in `decide`

The decision is about the channel the request came through, not the aggregate's state, and the policy is a server Layer. `decide` runs where only request contexts travel, so it could not read the policy. A middleware is also Alchemy's own shape for a guard on sensitive commands (`MfaChallenge`). Stories skip middleware, so approval is tested through the Api.

## What it does not do

- Ask the human. The old `Mean.elicitation` asked the MCP client to confirm; that needs the MCP client inside the RPC call, which `toToolkit` does not pass on. An app that needs it writes its own `Approval.policy`-style Layer for `ApprovalGate`.
- Detect agents on its own. `via` comes from the `x-house-rules-via` header, set by the server's MCP route (`viaAgent`, see `../auth/README.md`). An agent that calls the HTTP Api directly with a person's token looks like that person.
