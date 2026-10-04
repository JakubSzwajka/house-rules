const config = require("@house-rules/rules/dependency-cruiser").layout({
  scope: "@hosti/",
});

config.options.exclude.path = `${config.options.exclude.path}|^packages/rules/|^astro:`;

module.exports = config;
