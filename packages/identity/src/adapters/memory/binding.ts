import { type ActorId, UnitOfWork } from "@house-rules/domain";
import { Clock, Effect, Layer } from "effect";
import type { Binding, BindingKey } from "../../binding/binding.js";
import { BindingStore } from "../../storage.js";

const keyOf = (key: BindingKey) => JSON.stringify([key.issuer, key.subject]);
const byKey = (a: Binding, b: Binding) =>
  a.issuer < b.issuer ? -1 : a.issuer > b.issuer ? 1 : a.subject < b.subject ? -1 : 1;

export const memoryBindingStore = (): Layer.Layer<BindingStore> =>
  Layer.sync(BindingStore, () => {
    const rows = new Map<string, Binding>();
    const change = Effect.fn("BindingStore.memory.change")(function* (run: () => void) {
      yield* UnitOfWork.required;
      const before = new Map(rows);
      yield* UnitOfWork.onRollback(
        Effect.sync(() => {
          rows.clear();
          for (const [key, binding] of before) rows.set(key, binding);
        }),
      );
      run();
    });
    const removeWhere = (keep: (binding: Binding) => boolean) =>
      change(() => {
        for (const [key, binding] of rows) if (!keep(binding)) rows.delete(key);
      });
    return BindingStore.of({
      find: (key) => Effect.sync(() => rows.get(keyOf(key))?.actorId),
      claim: Effect.fn("BindingStore.memory.claim")(function* (key: BindingKey, actorId: ActorId) {
        yield* UnitOfWork.required;
        const held = rows.get(keyOf(key));
        if (held !== undefined) return held.actorId;
        const createdAt = yield* Clock.currentTimeMillis;
        const binding = { issuer: key.issuer, subject: key.subject, actorId, createdAt };
        yield* change(() => void rows.set(keyOf(key), binding));
        return actorId;
      }),
      remove: (actorId, key) =>
        removeWhere(
          (binding) =>
            !(
              binding.actorId === actorId &&
              binding.issuer === key.issuer &&
              binding.subject === key.subject
            ),
        ),
      list: (actorId) =>
        Effect.sync(() =>
          [...rows.values()]
            .filter((binding) => binding.actorId === actorId)
            .sort(byKey)
            .map((binding) => ({ ...binding })),
        ),
      removeAll: (actorId) => removeWhere((binding) => binding.actorId !== actorId),
    });
  });
