import { assert, it } from "@effect/vitest";
import { Effect } from "effect";
import { afterEach, vi } from "vitest";
import { copyText } from "../clipboard.ts";

afterEach(() => vi.unstubAllGlobals());

function fallback(result: boolean) {
  const textarea = {
    value: "",
    readOnly: false,
    style: { position: "", opacity: "" },
    select: vi.fn(),
    remove: vi.fn(),
  };
  const append = vi.fn();
  const execCommand = vi.fn(() => result);
  vi.stubGlobal("document", { createElement: () => textarea, body: { append }, execCommand });
  return { textarea, append, execCommand };
}

it.effect("copies on HTTP without navigator.clipboard and removes its hidden textarea", () =>
  Effect.gen(function* () {
    vi.stubGlobal("navigator", {});
    const { textarea, append, execCommand } = fallback(true);
    assert.isTrue(yield* Effect.promise(() => copyText("invitation-code")));
    assert.strictEqual(textarea.value, "invitation-code");
    assert.isTrue(textarea.readOnly);
    assert.strictEqual(textarea.style.opacity, "0");
    assert.strictEqual(append.mock.calls.length, 1);
    assert.strictEqual(textarea.select.mock.calls.length, 1);
    assert.deepStrictEqual(execCommand.mock.calls, [["copy"]]);
    assert.strictEqual(textarea.remove.mock.calls.length, 1);
  }),
);

it.effect("uses the clipboard API when available", () =>
  Effect.gen(function* () {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const { append } = fallback(true);
    assert.isTrue(yield* Effect.promise(() => copyText("code")));
    assert.deepStrictEqual(writeText.mock.calls, [["code"]]);
    assert.strictEqual(append.mock.calls.length, 0);
  }),
);

it.effect("falls back after clipboard rejection and reports failure without throwing", () =>
  Effect.gen(function* () {
    vi.stubGlobal("navigator", { clipboard: { writeText: () => Promise.reject("denied") } });
    const { textarea, execCommand } = fallback(false);
    assert.isFalse(yield* Effect.promise(() => copyText("code")));
    assert.strictEqual(textarea.remove.mock.calls.length, 1);
    execCommand.mockImplementation(() => {
      throw new Error("blocked");
    });
    assert.isFalse(yield* Effect.promise(() => copyText("code")));
    assert.strictEqual(textarea.remove.mock.calls.length, 2);
  }),
);
