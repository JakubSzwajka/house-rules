import { assert, it } from "@effect/vitest";
import { Effect } from "effect";
import { ActorId } from "@house-rules/domain/contract";
import { canAdmin, permissionsAt, roleOptions, type Profile, type Roles } from "../dashboard.tsx";
import { roleInput } from "../roles-panel.tsx";
const id = ActorId.make("admin");
const roles: Roles = [
  {
    key: "admin",
    name: "Admin",
    builtIn: true,
    organisationId: null,
    permissions: ["party:read", "party:admin"],
  },
];
const profile: Profile = {
  person: { id, displayName: "Admin", createdAt: 0 },
  access: {
    roles: [{ personId: id, roleKey: "admin", organisationId: null }],
    permissions: ["party:read", "party:admin"],
    catalogue: [],
  },
};
it.effect(
  "role screen automatically loads its catalogue, then builds a complete admin role request",
  () =>
    Effect.gen(function* () {
      const calls: string[] = [];
      const options = yield* Effect.promise(() =>
        roleOptions({
          listPermissions: () => {
            calls.push("catalogue");
            return Promise.resolve(["party:read", "party:admin"]);
          },
          listRoles: () => {
            calls.push("roles");
            return Promise.resolve(roles);
          },
        }),
      );
      assert.deepStrictEqual(calls, ["catalogue", "roles"]);
      assert.isTrue(canAdmin(profile, options.roles, null));
      assert.isTrue(permissionsAt(profile, options.roles, null).has(options.catalogue[0] ?? ""));
      const data = new FormData();
      data.set("key", "booking-reader");
      data.set("name", "Booking reader");
      assert.deepStrictEqual(roleInput(data, "global", ["party:read"]), {
        key: "booking-reader",
        name: "Booking reader",
        organisationId: null,
        permissions: ["party:read"],
      });
    }),
);
it.effect(
  "org administrators cannot delegate their scoped permissions globally or into another org",
  () =>
    Effect.sync(() => {
      const scoped: Profile = {
        ...profile,
        access: {
          ...profile.access,
          roles: [{ personId: id, roleKey: "admin", organisationId: "acme" }],
        },
      };
      assert.isFalse(canAdmin(scoped, roles, null));
      assert.isTrue(canAdmin(scoped, roles, "acme"));
      assert.isFalse(canAdmin(scoped, roles, "other"));
      assert.isFalse(permissionsAt(scoped, roles, "other").has("party:read"));
    }),
);
