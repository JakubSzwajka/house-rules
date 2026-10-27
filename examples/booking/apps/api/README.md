# Booking API

The booking showcase app. [MAP.md](MAP.md) is its text app map and [plan.json](plan.json) is the same design as a plan.

## Entry points

All 12 queries use defineReadModel and the ReadModels registry. This includes the system-start due_payments schedule selector. The 17 commands stay in Features. Ways expose these descriptors directly through one shared runtime, with unchanged names, paths and permissions. MCP still exposes only show_booking and my_bookings; the migrated person queries stay HTTP-only.

MyBookings SQL stays in projections/my-bookings with its mount and published-view privacy tests. AuditTrail stays in projections/audit-trail. Neither projection is an exposed entry point. show_booking uses domain operations without SQL in its handler.

This is a breaking source-authoring change: import migrated query descriptors from read-models/index.ts rather than features/index.ts. HTTP clients keep the same endpoint keys and wire paths.

## Map and plan pages

Run these from the repository root. Paths resolve from where you run the command. Do not commit the generated HTML.

```text
pnpm --filter @example/api run map -- --html -o /tmp/booking-map.html
pnpm --filter @example/api run map -- --diff --text
pnpm --filter @example/api run map -- --diff path/to/changed-plan.json -o /tmp/change.html
```

`--html` writes the built app's map as one self-contained page. `--diff` compares the built app (before) with a plan (after); without a path it uses this app's plan.json, which must show no changes. `--text` prints the diff as text. The root `pnpm plan view|diff` command does the same for plain plan.json or map JSON files without building the app. `pnpm plan validate` checks a plan and prints `valid`.
