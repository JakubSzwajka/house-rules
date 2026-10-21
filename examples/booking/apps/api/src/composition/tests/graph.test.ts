import { assert, it } from "@effect/vitest";
import { Effect } from "effect";
import {
  Entries,
  memberPermissions,
  partnerPermissions,
  agentPermissions,
  systemPermissions,
} from "../entries.ts";

it.effect("seven app entries retain exact closures, starts, edges and lifted flags", () =>
  Effect.sync(() => {
    assert.deepStrictEqual(memberPermissions, [
      "bookings:read",
      "bookings:write",
      "bookings:cancel",
      "billing:charge",
    ]);
    assert.deepStrictEqual(partnerPermissions, ["bookings:write"]);
    assert.deepStrictEqual(agentPermissions, ["bookings:read"]);
    assert.deepStrictEqual(systemPermissions, [
      "billing:refund",
      "billing:expire",
      "party:create",
      "identity:bind",
    ]);
    const expected: readonly unknown[] = [
      [
        "make_booking",
        ["bookings:write", "billing:charge"],
        [],
        false,
        true,
        false,
        false,
        ["Bookings.book", "Billing.initPayment"],
      ],
      ["book_for_partner", ["bookings:write"], [], false, true, false, false, ["Bookings.book"]],
      [
        "cancel_booking",
        ["bookings:cancel"],
        ["billing:refund"],
        false,
        true,
        true,
        true,
        ["Bookings.cancel", "Billing.refund"],
      ],
      ["show_booking", ["bookings:read"], [], true, false, false, false, ["Bookings.get"]],
      ["my_bookings", ["bookings:read"], [], true, false, false, false, ["MyStuff.myBookings"]],
      [
        "first_sign_in",
        [],
        ["party:create", "identity:bind"],
        false,
        true,
        false,
        false,
        ["Party.createPerson", "Identity.bindLogin"],
      ],
      [
        "nightly_cleanup",
        [],
        ["billing:expire"],
        false,
        true,
        false,
        false,
        ["Billing.expirePending"],
      ],
    ];
    assert.deepStrictEqual<readonly unknown[]>(
      Object.values(Entries).map((e) => [
        e.node.name,
        e.closures.person,
        e.closures.system,
        e.readOnly,
        e.transactional,
        e.destructive,
        e.needsApproval,
        e.node.edges.map((edge) => ("target" in edge ? edge.target.name : edge.name)),
      ]),
      expected,
    );
    assert.deepStrictEqual(Entries.firstSignIn.start, {
      kind: "system",
      reason: "new login",
      startedBy: "hook:new-login",
    });
    assert.deepStrictEqual(Entries.nightlyCleanup.start, {
      kind: "system",
      reason: "nightly cleanup",
      startedBy: "schedule:nightly_cleanup",
    });
  }),
);
