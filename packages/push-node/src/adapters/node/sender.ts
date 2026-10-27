import { PushSender, PushSendFailed } from "@house-rules/push";
import { Effect, Layer, Schema } from "effect";
import webPush from "web-push";

export type WebPushSenderOptions = {
  readonly subject: string;
  readonly publicKey: string;
  readonly privateKey: string;
  readonly timeoutMs?: number;
};

const Timeout = Schema.Int.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(2147483647));
const Ttl = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const ProviderStatus = Schema.Struct({ statusCode: Schema.Literals([404, 410]) });

type SendNotification = (
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: string,
  options: {
    TTL: number;
    timeout: number;
    contentEncoding: "aes128gcm";
    vapidDetails: { subject: string; publicKey: string; privateKey: string };
  },
) => Promise<unknown>;

export const webPushSender = (options: WebPushSenderOptions): Layer.Layer<PushSender> =>
  makeWebPushSender(options, (subscription, payload, requestOptions) =>
    webPush.sendNotification(subscription, payload, requestOptions),
  );

export const makeWebPushSender = (
  options: WebPushSenderOptions,
  sendNotification: SendNotification,
): Layer.Layer<PushSender> => {
  const { subject, publicKey, privateKey, timeoutMs = 10000 } = options;
  return Layer.effect(
    PushSender,
    Effect.gen(function* () {
      const timeout = yield* Schema.decodeEffect(Timeout)(timeoutMs).pipe(
        Effect.mapError((cause) => new PushSendFailed({ cause })),
      );
      // Use the SDK's public, local-only validator. Never mutate its global VAPID settings.
      yield* Effect.try({
        try: () =>
          webPush.getVapidHeaders(
            "https://example.invalid",
            subject,
            publicKey,
            privateKey,
            "aes128gcm",
          ),
        catch: (cause) => new PushSendFailed({ cause }),
      });
      return PushSender.of({
        send: Effect.fnUntraced(function* (subscription, payload, sendOptions) {
          const ttl = yield* Schema.decodeEffect(Ttl)(sendOptions.ttl).pipe(
            Effect.mapError((cause) => new PushSendFailed({ cause })),
          );
          const encoded = yield* Effect.try({
            try: () => JSON.stringify(payload),
            catch: (cause) => new PushSendFailed({ cause }),
          });
          // JSON.stringify can return undefined for non-JSON values without throwing.
          if (encoded === undefined) {
            return yield* new PushSendFailed({ cause: "Push payload is not JSON serializable." });
          }
          return yield* Effect.tryPromise({
            try: () =>
              sendNotification(
                { endpoint: subscription.endpoint, keys: { ...subscription.keys } },
                encoded,
                {
                  TTL: ttl,
                  timeout,
                  contentEncoding: "aes128gcm",
                  vapidDetails: { subject, publicKey, privateKey },
                },
              ),
            catch: (cause) => new PushSendFailed({ cause }),
          }).pipe(
            Effect.as("sent" as const),
            Effect.catchIf(
              (error) => Schema.is(ProviderStatus)(error.cause),
              () => Effect.succeed("gone" as const),
            ),
          );
        }),
      });
    }).pipe(
      Effect.catch((error) => Effect.succeed(PushSender.of({ send: () => Effect.fail(error) }))),
    ),
  );
};
