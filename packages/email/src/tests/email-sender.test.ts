import { expect, it } from "@effect/vitest";
import { Effect, Layer, Logger } from "effect";
import {
  consoleEmail,
  EmailRejected,
  EmailSender,
  MemoryEmailOutboxTesting,
  memoryEmail,
} from "../index.ts";

const email = {
  to: "person@example.test",
  subject: "Hello",
  text: "Message body",
  idempotencyKey: "delivery-1",
} as const;

it.effect("memory records one message for retries with the same idempotency key", () =>
  Effect.gen(function* () {
    const sender = yield* EmailSender;
    const outbox = yield* MemoryEmailOutboxTesting;
    yield* sender.send(email);
    yield* sender.send({ ...email, subject: "Changed subject", text: "Changed body" });
    const messages = yield* outbox.messages;
    expect(messages).toHaveLength(1);
    expect(messages[0]?.from).toBe("noreply@example.test");
    expect(messages[0]?.subject).toBe("Hello");
    expect(messages[0]?.text).toBe("Message body");
  }).pipe(Effect.provide(memoryEmail({ defaultFrom: "noreply@example.test" }))),
);

it.effect("memory rejects invalid input", () =>
  Effect.gen(function* () {
    const sender = yield* EmailSender;
    const error = yield* sender.send({ ...email, to: " " }).pipe(Effect.flip);
    expect(error).toBeInstanceOf(EmailRejected);
    expect(error.kind).toBe("invalid");
  }).pipe(Effect.provide(memoryEmail({ defaultFrom: "noreply@example.test" }))),
);

it.effect("console adapter rejects invalid input", () =>
  Effect.gen(function* () {
    const sender = yield* EmailSender;
    const error = yield* sender.send({ ...email, to: " " }).pipe(Effect.flip);
    expect(error).toBeInstanceOf(EmailRejected);
  }).pipe(Effect.provide(consoleEmail({ defaultFrom: "noreply@example.test" }))),
);

it.effect("console adapter logs no recipient, subject, or body", () => {
  const lines: Array<unknown> = [];
  return Effect.gen(function* () {
    const sender = yield* EmailSender;
    yield* sender.send({
      ...email,
      to: "private-recipient@example.test",
      subject: "Private subject",
      text: "Private body",
    });
    const output = JSON.stringify(lines);
    expect(output).not.toContain("private-recipient@example.test");
    expect(output).not.toContain("Private subject");
    expect(output).not.toContain("Private body");
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        consoleEmail({ defaultFrom: "noreply@example.test" }),
        Logger.layer([Logger.make(({ message }) => lines.push(message))]),
      ),
    ),
  );
});

it.effect("rejects CR/LF in email and header fields", () =>
  Effect.gen(function* () {
    const sender = yield* EmailSender;
    const invalidMessages = [
      { ...email, to: "person@example.test\r\nBcc:other@example.test" },
      { ...email, from: "sender@example.test\nBcc:other@example.test" },
      { ...email, subject: "Hello\r\nBcc:other@example.test" },
      { ...email, headers: { "X-Test\r\nInjected": "value" } },
      { ...email, headers: { "X-Test": "value\nInjected: yes" } },
    ];
    for (const invalid of invalidMessages) {
      const error = yield* sender.send(invalid).pipe(Effect.flip);
      expect(error).toBeInstanceOf(EmailRejected);
    }
  }).pipe(Effect.provide(memoryEmail({ defaultFrom: "noreply@example.test" }))),
);

it.effect("rejects explicit blank senders in both adapters", () =>
  Effect.gen(function* () {
    for (const adapter of [memoryEmail, consoleEmail]) {
      yield* Effect.gen(function* () {
        const sender = yield* EmailSender;
        for (const from of ["", " "]) {
          expect(yield* sender.send({ ...email, from }).pipe(Effect.flip)).toBeInstanceOf(
            EmailRejected,
          );
        }
      }).pipe(Effect.provide(adapter({ defaultFrom: "noreply@example.test" })));
    }
  }),
);

it.effect("rejects an empty default sender", () =>
  Effect.gen(function* () {
    const sender = yield* EmailSender;
    const error = yield* sender.send(email).pipe(Effect.flip);
    expect(error).toBeInstanceOf(EmailRejected);
  }).pipe(Effect.provide(memoryEmail({ defaultFrom: "" }))),
);
