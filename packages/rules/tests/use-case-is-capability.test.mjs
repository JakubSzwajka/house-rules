import assert from "node:assert/strict";
import test from "node:test";
import { Linter } from "eslint";
import plugin from "../src/index.mjs";

const USE_CASE = "apps/api/src/use-cases/show-booking.ts";
const IMPORTS = 'import { defineContract, implement } from "@house-rules/capability";\n';
const CAPABILITY = [
  'export const showBookingContract = defineContract("show_booking", spec);',
  "export const showBooking = implement(showBookingContract, handler);",
].join("\n");

function lint(code, filename = USE_CASE, options) {
  const config = plugin.configs.capability.map((entry) => ({
    ...entry,
    rules: entry.rules["house-rules/use-case-is-capability"]
      ? { "house-rules/use-case-is-capability": options ? ["error", options] : "error" }
      : {},
  }));
  const messages = new Linter().verify(code, config, { filename });
  assert.equal(
    messages.some((message) => message.fatal),
    false,
    messages.map((message) => message.message).join("\n"),
  );
  return messages.map(({ messageId, line }) => [messageId, line]);
}

test("passes a use-case with one capability, one contract, and type exports", () => {
  const code = `${IMPORTS}import type { Booking } from "@hosti/bookings";
export type ShowBooking = typeof showBooking;
export interface View { readonly id: string }
export type { Booking };
const handler = () => undefined;
${CAPABILITY}`;
  assert.deepEqual(lint(code), []);
});

test("passes a capability without an exported contract, and a local export list", () => {
  const code = `${IMPORTS}const contract = defineContract("ping", spec);
const ping = implement(contract, handler) satisfies unknown;
export { ping };`;
  assert.deepEqual(lint(code), []);
});

test("accepts a namespace import of the capability library", () => {
  const code = `import * as Capability from "@house-rules/capability";
export const ping = Capability.implement(Capability.defineContract("ping", spec), handler);`;
  assert.deepEqual(lint(code), []);
});

test("checks nested use-case folders", () => {
  assert.deepEqual(lint("export const x = 1;", "apps/web/src/use-cases/trips/create-trip.ts"), [
    ["missingCapability", 1],
    ["otherExport", 1],
  ]);
});

test("fails a use-case that exports no capability", () => {
  const code = `import { Effect } from "effect";
export const showBooking = Effect.fn("showBooking")(function* () {});`;
  assert.deepEqual(lint(code), [
    ["missingCapability", 1],
    ["otherExport", 2],
  ]);
});

test("fails an implement that does not come from @house-rules/capability", () => {
  const code = `import { implement } from "./implement";
export const showBooking = implement(contract, handler);`;
  assert.deepEqual(lint(code), [
    ["missingCapability", 1],
    ["otherExport", 2],
  ]);
});

test("fails a local implement that shadows the import", () => {
  const code = `${IMPORTS}function build() {
  const implement = (a, b) => a;
  return implement(1, 2);
}
export const showBooking = build();`;
  assert.deepEqual(lint(code), [
    ["missingCapability", 1],
    ["otherExport", 6],
  ]);
});

test("fails a second capability and a second contract", () => {
  const code = `${IMPORTS}${CAPABILITY}
export const otherContract = defineContract("other", spec);
export const other = implement(otherContract, handler);`;
  assert.deepEqual(lint(code), [
    ["extraContract", 4],
    ["extraCapability", 5],
  ]);
});

test("fails other value exports", () => {
  const code = `${IMPORTS}${CAPABILITY}
export function format() {}
export class View {}
export let count = implement(contract, handler);
export enum Kind { A }
export default showBooking;
export { helper } from "./helper";
export * from "./more";`;
  assert.deepEqual(lint(code), [
    ["otherExport", 4],
    ["otherExport", 5],
    ["otherExport", 6],
    ["otherExport", 7],
    ["otherExport", 8],
    ["otherExport", 9],
    ["otherExport", 10],
  ]);
});

test("skips tests, files outside use-cases, and honours include and exclude", () => {
  const code = "export const x = 1;";
  assert.deepEqual(lint(code, "apps/api/src/use-cases/tests/show-booking.test.ts"), []);
  assert.deepEqual(lint(code, "apps/api/src/use-cases/show-booking.test.ts"), []);
  assert.deepEqual(lint(code, "apps/api/src/delivery/http/route.ts"), []);
  assert.deepEqual(lint(code, "packages/bookings/src/facade.ts"), []);
  assert.deepEqual(lint(code, "src/actions/show.ts", { include: ["src/actions/**"] }), [
    ["missingCapability", 1],
    ["otherExport", 1],
  ]);
  assert.deepEqual(
    lint(code, "apps/api/src/use-cases/legacy.ts", {
      include: ["apps/*/src/use-cases/**"],
      exclude: ["**/legacy.ts"],
    }),
    [],
  );
});

test("messages name the fix", () => {
  const { messages } = plugin.rules["use-case-is-capability"].meta;
  assert.match(messages.missingCapability, /implement\(contract, handler\)/);
  assert.match(messages.missingCapability, /@house-rules\/capability/);
  assert.match(messages.otherExport, /only its capability, its contract, and types/);
});
