import * as Domain from "@alchemy.run/domain";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

export const TallyId = Schema.NonEmptyString.pipe(Schema.brand("TallyId"));
export type TallyId = typeof TallyId.Type;

export class TallyOpened extends Domain.Event("TallyOpened", { closeAfterMillis: Schema.Finite }) {}
export class TallyAdded extends Domain.Event("TallyAdded", {
  amount: Schema.Finite,
  total: Schema.Finite,
}) {}
export class TallyClosed extends Domain.Event("TallyClosed", { total: Schema.Finite }) {}

export class TallyExists extends Domain.Rejection("TallyExists", {}, { httpApiStatus: 409 }) {}
export class TallyNotOpen extends Domain.Rejection("TallyNotOpen", {}, { httpApiStatus: 409 }) {}

export class OpenTally extends Domain.Command("OpenTally", {
  target: TallyId,
  input: { closeAfterMillis: Schema.Finite },
  events: [TallyOpened],
  rejects: [TallyExists],
}) {}

export class AddToTally extends Domain.Command("AddToTally", {
  target: TallyId,
  input: { amount: Schema.Finite },
  events: [TallyAdded],
  rejects: [TallyNotOpen],
}) {}

export class CloseTally extends Domain.Command("CloseTally", {
  target: TallyId,
  events: [TallyClosed],
  rejects: [],
}) {}

const Open = Schema.TaggedStruct("Open", { total: Schema.Finite });
const Closed = Schema.TaggedStruct("Closed", { total: Schema.Finite });

export class Tally extends Domain.Aggregate("Tally", {
  id: TallyId,
  state: Schema.Union([Schema.TaggedStruct("New", {}), Open, Closed]),
  initial: { _tag: "New" },
  commands: [OpenTally, AddToTally, CloseTally],
  decide: {
    OpenTally: (tally, cmd) =>
      tally._tag === "New"
        ? [new TallyOpened({ closeAfterMillis: cmd.closeAfterMillis })]
        : new TallyExists(),
    AddToTally: (tally, cmd) =>
      tally._tag === "Open"
        ? [new TallyAdded({ amount: cmd.amount, total: tally.total + cmd.amount })]
        : new TallyNotOpen(),
    CloseTally: (tally) => (tally._tag === "Open" ? [new TallyClosed({ total: tally.total })] : []),
  },
  evolve: {
    TallyOpened: () => ({ _tag: "Open" as const, total: 0 }),
    TallyAdded: (s, e) => (s._tag === "Open" ? { ...s, total: e.total } : s),
    TallyClosed: (_, e) => ({ _tag: "Closed" as const, total: e.total }),
  },
}) {}

export class AuditRecorded extends Domain.Event("AuditRecorded", { count: Schema.Finite }) {}

export class RecordAudit extends Domain.Command("RecordAudit", {
  target: TallyId,
  events: [AuditRecorded],
  rejects: [],
}) {}

export class Audit extends Domain.Aggregate("Audit", {
  id: TallyId,
  state: Schema.Struct({ count: Schema.Finite }),
  initial: { count: 0 },
  commands: [RecordAudit],
  decide: { RecordAudit: (audit) => [new AuditRecorded({ count: audit.count + 1 })] },
  evolve: { AuditRecorded: (_, e) => ({ count: e.count }) },
}) {}

export class TallyTotals extends Domain.View("TallyTotals", {
  from: [Tally],
  key: Tally,
  state: Schema.Struct({ total: Schema.Finite, adds: Schema.Finite, closed: Schema.Boolean }),
  initial: { total: 0, adds: 0, closed: false },
  evolve: {
    TallyAdded: (v, e) => ({ ...v, total: e.total, adds: v.adds + 1 }),
    TallyClosed: (v) => ({ ...v, closed: true }),
  },
}) {}

export class AutoClose extends Domain.Policy("AutoClose", { from: Tally, on: [TallyOpened] }) {}
export class AuditAdds extends Domain.Policy("AuditAdds", { from: Tally, on: [TallyAdded] }) {}

export const AutoCloseLive = AutoClose.toLayer(
  Effect.gen(function* () {
    const tallies = yield* Tally;
    return Effect.fn(function* ({ source, event }) {
      yield* tallies
        .schedule(source.id, new CloseTally(), {
          after: `${event.closeAfterMillis} millis`,
          commandId: "auto-close",
        })
        .pipe(Effect.catchTag("AlreadyExecuted", () => Effect.void));
    });
  }),
);

export const AuditAddsLive = AuditAdds.toLayer(
  Effect.gen(function* () {
    const audits = yield* Audit;
    return Effect.fn(function* ({ source, envelope }) {
      yield* audits
        .send(source.id, new RecordAudit(), { commandId: `audit:${envelope.seq}` })
        .pipe(Effect.orDie);
    });
  }),
);

export class Tallies extends Domain.Model("Tallies", {
  aggregates: [Tally, Audit],
  views: [TallyTotals],
  policies: [AutoClose, AuditAdds],
}) {}

export class TallyApi extends Domain.Api("TallyApi", {
  model: Tallies,
  commands: ["OpenTally", "AddToTally"],
  views: ["TallyTotals"],
  aggregates: [],
  streams: [],
}) {}

export const TalliesLive = Tallies.layer(Layer.mergeAll(AutoCloseLive, AuditAddsLive));
