# @house-rules/push-node

Optional Node Web Push cartridge for the portable `@house-rules/push` sender port. Apps supply configuration and choose this layer in composition. Import only the main entry.

```ts
import { Push } from "@house-rules/push";
import { webPushSender } from "@house-rules/push-node";

const sender = webPushSender({
  subject: config.vapidSubject,
  publicKey: config.vapidPublicKey,
  privateKey: config.vapidPrivateKey,
  timeoutMs: 10000,
});
const pushLayer = Push.layerPostgres({ defaultTtlSeconds: 86400 }, sender);
```

The app owns `config` and environment validation. This package reads no environment variables. Keep the private key in the app's secret store, never in browser code or logs. Removing this cartridge and choosing another explicit `PushSender` layer leaves core Push unchanged. There is no domain mount, operation, permission, database or migration here.

## API and failures

`webPushSender(options: WebPushSenderOptions): Layer.Layer<PushSender>` captures these values per layer:

| Option | Meaning |
| --- | --- |
| `subject` | VAPID contact, an HTTPS URL or mailto address |
| `publicKey` | URL-safe base64 VAPID public key |
| `privateKey` | URL-safe base64 VAPID private key |
| `timeoutMs?` | SDK socket inactivity timeout in milliseconds, default 10000. Integer from 1 through 2147483647 |

Layer acquisition validates configuration locally without sending a request. Invalid configuration supplies a sender that fails with `PushSendFailed` on each send. This keeps the existing infallible `PushSender` layer composition API. SDK public VAPID validation owns key validation. No global SDK setters are used.

`send(subscription, payload, { ttl, idempotencyKey? })` serializes the payload once with `JSON.stringify` and uses `aes128gcm`. Non-JSON values and serialization failures fail without sending. `ttl` passes unchanged as the SDK's `TTL`, in seconds. The adapter accepts nonnegative integers as the provider does; core Push owns its positive TTL policy and default. Invalid TTL fails rather than being clamped.

Provider acceptance returns `"sent"`, not a guarantee that a device received the message. Only provider status 404 or 410 returns `"gone"`. Other status codes, socket timeouts, network failures and synchronous SDK errors fail with the existing `PushSendFailed`. Its public message stays `Push delivery is unavailable. Try again shortly.` The internal cause can contain provider data. Do not expose or log the cause, endpoint, keys or payload. The adapter logs none of them.

## Delivery limits

The port accepts `idempotencyKey` as data. Web Push offers no provider-guaranteed deduplication or exactly-once delivery. This adapter does not pass that key as an unsupported SDK option, use Topic coalescing, or keep a ledger. Repeating a key sends again. Retries can redeliver, and a provider send cannot roll back with a database transaction. Core Push owns fanout, expiry and returned event facts. Nothing sends automatically.

`timeoutMs` is the SDK's socket inactivity timeout, not a total request deadline. Traffic can keep a request alive longer. Effect interruption stops waiting but does not cancel an in-flight SDK request, which can still complete. The SDK exposes no AbortSignal in this version. Disposing a layer does not recall sends.

## Build and verification

`pnpm --filter @house-rules/push-node typecheck` and `test` check the package. Tests stub the send function and inspect real SDK request generation without transport. They never contact a push service. Build domain, application and push first, then run `pnpm --filter @house-rules/push-node build`. Packing runs the build and ships `dist/`, this README and `AGENTS.md`. Published exports point only to `dist/index.js` and `dist/index.d.ts`; workspace exports point to source. There is no contract door or provider code in core Push's browser-safe contract.

The runtime dependency [web-push 3.6.7](https://github.com/web-push-libs/web-push/tree/v3.6.7) is MPL-2.0, copyright Marco Castelluccio and contributors. Its license ships in that dependency. Development-only [@types/web-push 3.6.4](https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/web-push) is MIT. This package contains no copied vendor source.
