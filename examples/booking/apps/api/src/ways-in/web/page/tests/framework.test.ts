import { assert, it } from "@effect/vitest";
import { Effect } from "effect";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { vi } from "vitest";
import { Features } from "../../../../features/index.ts";
import { ReadModels } from "../../../../read-models/index.ts";
import { FrameworkPanel } from "../framework-panel.tsx";

vi.mock("../dashboard.tsx", () => ({
  useDashboard: () => ({ client: {}, perform: () => Promise.resolve() }),
}));

it.effect("Framework panel renders all 29 entry points, including my_profile on web", () =>
  Effect.sync(() => {
    const html = renderToStaticMarkup(createElement(FrameworkPanel));
    const body = /<tbody\b[^>]*>([\s\S]*?)<\/tbody>/.exec(html)?.[1] ?? "";
    const rows = body.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/g) ?? [];
    assert.strictEqual(rows.length, 29);
    for (const entry of [...Object.values(Features), ...Object.values(ReadModels)]) {
      const matches = rows.filter((row) => row.includes(`>${entry.name}</button>`));
      assert.strictEqual(matches.length, 1, entry.name);
      assert.include(matches[0] ?? "", `>${entry.kind}</td>`);
    }
    const profile = rows.find((row) => row.includes(">my_profile</button>")) ?? "";
    assert.include(profile, ">web</span>");
    assert.notInclude(profile, ">mcp</span>");
    for (const name of ["show_booking", "my_bookings"]) {
      const row = rows.find((value) => value.includes(`>${name}</button>`)) ?? "";
      assert.include(row, ">web</span>");
      assert.include(row, ">mcp</span>");
    }
  }),
);
