const config = require("@house-rules/rules/dependency-cruiser").layout({
  scope: "@hosti/",
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

module.exports = config;
