# Booking API

The booking showcase app. [MAP.md](MAP.md) is its text app map and [plan.json](plan.json) is the same design as a plan.

## Entry points

show_booking and my_bookings are read-model entry points, made with defineReadModel. make_booking and cancel_booking are command features. Ways expose their actual descriptors directly, through one shared runtime. MyBookings SQL stays in projections/my-bookings with its mount and published-view privacy tests; show_booking uses domain operations without SQL in its handler. Other legacy read-only features deliberately remain feature-kind.

## Map and plan pages

Run these from the repository root. Paths resolve from where you run the command. Do not commit the generated HTML.

```text
pnpm --filter @example/api run map -- --html -o /tmp/booking-map.html
pnpm --filter @example/api run map -- --diff --text
pnpm --filter @example/api run map -- --diff path/to/changed-plan.json -o /tmp/change.html
```

`--html` writes the built app's map as one self-contained page. `--diff` compares the built app (before) with a plan (after); without a path it uses this app's plan.json, which must show no changes. `--text` prints the diff as text. The root `pnpm plan view|diff` command does the same for plain plan.json or map JSON files without building the app. `pnpm plan validate` checks a plan and prints `valid`.
