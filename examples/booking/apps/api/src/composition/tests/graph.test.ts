import { assert, it } from "@effect/vitest";
import { Effect } from "effect";
import { Features } from "../../features/index.ts";
import { builtInRoles, systemPermissions } from "../roles.ts";

it.effect("app features retain exact closures, starts, edges and lifted flags", () =>
  Effect.sync(() => {
    assert.deepStrictEqual(builtInRoles.member.permissions, [
      "identity:update",
      "bookings:read",
      "bookings:write",
      "bookings:cancel",
      "billing:charge",
      "party:read",
    ]);
    assert.deepStrictEqual(builtInRoles.partner.permissions, ["bookings:write"]);
    assert.deepStrictEqual(Object.keys(builtInRoles), ["member", "partner", "admin"]);
    assert.deepStrictEqual(systemPermissions, [
      "identity:create",
      "identity:sign-in",
      "party:create",
      "party:admin",
      "identity:bind",
      "billing:refund",
      "billing:expire",
    ]);
    const expected: readonly unknown[] = [
      ["sign_up", [], ["identity:create"], false, true, false, false, ["Identity.signUp"]],
      ["sign_in", [], ["identity:sign-in"], false, true, false, false, ["Identity.signIn"]],
      ["sign_out", [], [], false, false, false, false, []],
      [
        "change_password",
        ["identity:update"],
        [],
        false,
        true,
        false,
        false,
        ["Identity.changePassword"],
      ],
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
        ["party:create", "identity:bind", "party:admin"],
        false,
        true,
        false,
        false,
        ["Party.createPerson", "Identity.bindLogin", "Party.assignRole"],
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
      ["define_role", ["party:admin"], [], false, true, false, false, ["Party.defineRole"]],
      ["list_roles", ["party:read"], [], true, false, false, false, ["Party.listRoles"]],
      ["assign_role", ["party:admin"], [], false, true, false, false, ["Party.assignRole"]],
      ["revoke_role", ["party:admin"], [], false, true, true, true, ["Party.revokeRole"]],
    ];
    assert.deepStrictEqual<readonly unknown[]>(
      Object.values(Features).map((e) => [
        e.name,
        e.closures.person,
        e.closures.system,
        e.readOnly,
        e.transactional,
        e.destructive,
        e.needsApproval,
        e.edges.map((edge) => ("target" in edge ? edge.target.name : edge.name)),
      ]),
      expected,
    );
    assert.deepStrictEqual(Features.firstSignIn.start, {
      kind: "system",
      reason: "new login",
      startedBy: "hook:new-login",
    });
    assert.deepStrictEqual(Features.nightlyCleanup.start, {
      kind: "system",
      reason: "nightly cleanup",
      startedBy: "schedule:nightly_cleanup",
    });
  }),
);
