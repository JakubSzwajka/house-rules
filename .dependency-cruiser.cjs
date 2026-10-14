const config = require("@house-rules/rules/dependency-cruiser").layout({
  scope: "@example/",
  appsDir: ["apps", "examples/*/apps"],
  packagesDir: ["packages", "examples/*/packages"],
  adapterPackages: ["migrations"],
});

config.options.exclude.path = `${config.options.exclude.path}|^packages/rules/`;

const SITE = "^site/";
config.forbidden = config.forbidden.flatMap((rule) =>
  rule.name === "no-unresolved-imports"
    ? [
        { ...rule, from: { ...rule.from, pathNot: SITE } },
        {
          ...rule,
          name: "no-unresolved-imports-in-site",
          from: { ...rule.from, path: SITE },
          to: { ...rule.to, pathNot: "^astro:" },
        },
      ]
    : [rule],
);

config.forbidden.push({
  name: "framework-does-not-import-examples",
  comment:
    "A framework package under packages/ never imports anything under examples/. The exclusion above hides packages/rules from this rule, so tests/rules-imports-no-examples.test.mjs runs this ban alone over its src/ and bin/.",
  severity: "error",
  from: { path: "^packages/" },
  to: { path: "^examples/" },
});

module.exports = config;
