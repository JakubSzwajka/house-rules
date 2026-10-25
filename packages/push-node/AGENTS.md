# @house-rules/push-node: notes for agents

Use `webPushSender({ subject, publicKey, privateKey, timeoutMs? })` from the main entry in app composition. It returns `Layer.Layer<PushSender>` for `Push.layerPostgres(options, sender)` or `Push.layerMemory(options, sender)`. It is an optional Node cartridge, not a module mount. There are no operations, permissions, storage or migrations.

The app supplies configuration. Read no environment variables here. Capture VAPID values per layer and pass them per send, never through global SDK setters. Keep Node/SDK imports under `adapters/`. Export no subpaths and add no provider dependency to core Push.

`timeoutMs` defaults to 10000 and must be an integer from 1 through 2147483647. It sets the SDK socket inactivity timeout, not a total deadline. Interruption cannot cancel an in-flight SDK request. Configuration validation is local at layer acquisition; invalid config yields typed `PushSendFailed` on send, preserving infallible layer composition.

Serialize payloads once as JSON. Pass valid nonnegative integer TTL unchanged, with no adapter default or clamp. Only provider 404/410 means `gone`; SDK acceptance means `sent`. Map other failures, including synchronous throws, to existing `PushSendFailed({ cause })`. Keep its fixed public message. Never log keys, payload, endpoints or internal causes. Core Push owns fanout, expiry, units and event facts. Do not reconstruct them.

Accept the port's idempotency key as data only. No provider-guaranteed deduplication, Topic coalescing, ledger or exactly-once claim. Retries can redeliver. Nothing sends automatically. Production chooses an explicit sender layer; never install a fake default.

Tests use `it.effect` with stub sends and local SDK request generation, never live push endpoints. Use public package entries, except adapter-local tests may inspect their own implementation. Build dependencies first, then `build` or `pack` to emit the sole public dist entry. Keep this guide and README aligned with the public API.
