const config = require("@house-rules/rules/dependency-cruiser").layout({
  scope: "@hosti/",
  adapterPackages: ["migrations"],
});

config.options.exclude.path = `${config.options.exclude.path}|^packages/rules/|^astro:`;

module.exports = config;
