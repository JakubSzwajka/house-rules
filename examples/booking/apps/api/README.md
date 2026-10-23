# Booking API

The booking showcase app. [MAP.md](MAP.md) is its text app map and [plan.json](plan.json) is the same design as a plan.

## Map and plan pages

Run these from the repository root. Paths resolve from where you run the command. Do not commit the generated HTML.

```text
pnpm --filter @example/api run map -- --html -o /tmp/booking-map.html
pnpm --filter @example/api run map -- --diff --text
pnpm --filter @example/api run map -- --diff path/to/changed-plan.json -o /tmp/change.html
```

`--html` writes the built app's map as one self-contained page. `--diff` compares the built app (before) with a plan (after); without a path it uses this app's plan.json, which must show no changes. `--text` prints the diff as text. The root `pnpm plan view|diff` command does the same for plain plan.json or map JSON files without building the app.
