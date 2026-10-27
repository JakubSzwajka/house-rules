import { assert, it } from "@effect/vitest";
import { Effect } from "effect";
import { Features } from "../features/index.ts";
import { ReadModels } from "../read-models/index.ts";
import { api } from "../ways-in/web/endpoints.ts";
import { mcpWay } from "../ways-in/mcp/way.ts";
import { nightlyCleanupWay } from "../ways-in/schedules/nightly-cleanup.ts";

it.effect("keeps migrated queries direct and preserves endpoint keys, paths and exposures", () =>
  Effect.sync(() => {
    assert.strictEqual(Object.keys(Features).length, 17);
    assert.isTrue(
      Object.values(Features).every((entry) => entry.kind === "feature" && !entry.readOnly),
    );
    assert.strictEqual(Object.keys(ReadModels).length, 12);
    assert.isTrue(
      Object.values(ReadModels).every((entry) => entry.kind === "read-model" && entry.readOnly),
    );
    for (const key of [
      "listInvitations",
      "listMembers",
      "listPeople",
      "listPermissions",
      "listRoles",
      "myActivity",
      "myOrganisations",
      "myProfile",
      "recentAudit",
    ] as const) {
      const query = ReadModels[key];
      const endpoint = api.endpoints[key];
      assert.strictEqual(endpoint.feature, query);
      assert.strictEqual(endpoint.method, "POST");
      assert.strictEqual(`${api.prefix}${endpoint.path}`, `/api/${query.name}`);
      assert.isTrue(query.edges.every((edge) => edge.readOnly));
    }
    assert.strictEqual(nightlyCleanupWay.features[0], ReadModels.duePayments);
    assert.deepStrictEqual(mcpWay.features, [ReadModels.showBooking, ReadModels.myBookings]);
  }),
);
