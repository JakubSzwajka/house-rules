# Exact-pins checker

Bin: `house-rules-pins` (`bin/pins.mjs`)

Moved from drunk-cat-stack's `scripts/check-exact-pins.mjs` with the same behavior, messages and exit codes. Its tests moved too, to `tests/pins.test.mjs`. Since then it also accepts a commit-pinned Git spec with a pnpm `&path:` subpath.

```json
// package.json
{
  "scripts": {
    "pins": "house-rules-pins"
  }
}
```

## What passes

Every entry in `dependencies`, `devDependencies` and `optionalDependencies` must be one of:

- an exact version, prerelease or build included: `1.2.3`, `4.0.0-rc.1`
- an npm alias to an exact version: `npm:real-name@2.0.0`
- `workspace:` plus an exact version: `workspace:0.0.0`
- a Git spec pinned to a full 40-character commit: `github:owner/repo#<sha>`, `git+https://...#<sha>`, `git+ssh://...#<sha>`
- the same Git spec plus a pnpm subpath after the commit: `github:owner/repo#<sha>&path:/packages/rules`. The path starts with `/`, has no empty, `.` or `..` segment, and no trailing `/`. A branch, tag or short SHA before `&path:` still fails.

`packageManager`, when set, must end in an exact version.

## Which manifests

- With arguments, it checks exactly those `package.json` paths.
- Without arguments, it reads the `packages:` list from `pnpm-workspace.yaml` in the working directory, and checks the root `package.json` plus every matching `<pattern>/package.json`. No `packages:` list is an error.

## Output and exit codes

- `0`: prints `pins: every dependency is exact in <paths>`.
- `1`: prints `Dependencies in <path> must be exact versions or full commit SHAs:` and one `  <field>.<name>: <spec>` line per loose entry, then `See https://stack.kubaszwajka.com/rules/#exact-pins`, to stderr.
