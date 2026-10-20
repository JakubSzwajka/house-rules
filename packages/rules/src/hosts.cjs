"use strict";

// The hosts `layout({ host })` and `shadcn({ host })` know. Each lists the files its framework owns, so
// an app names none of them itself. layout() loads this file, so it stays CommonJS and loads nothing.
const HOSTS = Object.freeze({
  next: Object.freeze({
    waysInLayer: "app",
    appEntryFiles: Object.freeze(["proxy.ts", "instrumentation.ts"]),
    generatedDeclarationFiles: Object.freeze(["next-env.d.ts"]),
    buildOutputFolders: Object.freeze([".next"]),
    // Build output and the generated declaration, which no lint rule should read. configs.nextHost.
    eslintIgnores: Object.freeze(["**/.next/**", "**/next-env.d.ts"]),
    // Next renders the root error boundary in place of the root layout, so the app's components
    // and stylesheet may be missing there.
    shellFreeFiles: Object.freeze(["**/app/global-error.{jsx,tsx}"]),
  }),
});

function hostOption(host, caller) {
  if (host === undefined) return null;
  if (typeof host !== "string" || !Object.hasOwn(HOSTS, host)) {
    throw new TypeError(
      `${caller}: unknown host ${JSON.stringify(host)}. Known hosts: ${Object.keys(HOSTS).join(", ")}.`,
    );
  }
  return HOSTS[host];
}

module.exports = { HOSTS, hostOption };
