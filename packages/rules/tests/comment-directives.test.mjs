import assert from "node:assert/strict";
import test from "node:test";
import { assertLocations, commentMessages } from "./test-helpers.mjs";

const tripleSlashDirectives = [
  '/// <reference path="./types.d.ts" />',
  "/// <reference path='./types.d.ts' preserve='true' />",
  '/// <reference types="node" />',
  '/// <reference types="node" resolution-mode="import" />',
  '/// <reference lib="es2024" />',
  '/// <reference no-default-lib="true" />',
  '/// <amd-module name="acme" />',
  '/// <amd-dependency path="legacy" name="legacyName" />',
];

test("allows valid TypeScript triple-slash directives", () => {
  for (const directive of tripleSlashDirectives) {
    assert.deepEqual(commentMessages(`${directive}\nexport {};`), [], directive);
  }
});

test("allows precise TypeScript, ESLint, and Biome directives", () => {
  const directives = [
    "// @ts-check",
    "// @ts-nocheck",
    "// @ts-ignore",
    "// @ts-expect-error",
    "/* eslint-disable no-console */",
    "/* eslint-enable no-console, no-debugger */",
    "// eslint-disable-line no-console -- generated access is intentional",
    "// eslint-disable-next-line no-console",
    "/* global window:readonly, mutable:writable */",
    "/* exported publicName */",
    '/* eslint no-console: "error" */',
    "// biome-ignore lint/style/useConst: generated protocol shape",
    "// biome-ignore-all format: generated protocol shape",
  ];

  for (const directive of directives) {
    assert.deepEqual(commentMessages(`${directive}\nconst value = 1;`), [], directive);
  }
});

const coverageDirectives = [
  "// istanbul ignore if",
  "// istanbul ignore else",
  "// istanbul ignore next",
  "// istanbul ignore file",
  "// c8 ignore next",
  "// c8 ignore next 3",
  "// c8 ignore start",
  "// c8 ignore stop",
  "// v8 ignore next",
  "// v8 ignore start",
  "// v8 ignore stop",
  "// node:coverage disable",
  "// node:coverage enable",
];

test("allows precise coverage directives", () => {
  for (const directive of coverageDirectives) {
    assert.deepEqual(commentMessages(`${directive}\nconst value = 1;`), [], directive);
  }
});

test("allows source-map, Vite, webpack, PURE, and no-side-effects directives", () => {
  const cases = [
    "//# sourceMappingURL=subject.js.map\nconst value = 1;",
    "//@ sourceMappingURL=data:application/json;base64,e30=\nconst value = 1;",
    "/* @vite-ignore */\nconst value = 1;",
    '// webpackChunkName: "catalog"\nconst value = 1;',
    "// webpackMode: 'lazy'\nconst value = 1;",
    "// webpackPrefetch: true\nconst value = 1;",
    "// webpackPreload: 1\nconst value = 1;",
    "// webpackFetchPriority: 'high'\nconst value = 1;",
    "// webpackExports: 'default'\nconst value = 1;",
    "// webpackExports: ['default', \"named\"]\nconst value = 1;",
    '// webpackChunkName: "catalog", webpackPrefetch: true\nconst value = 1;',
    "// webpackInclude: /catalog/iu\nconst value = 1;",
    "// webpackExclude: /draft/\nconst value = 1;",
    "// webpackIgnore: true\nconst value = 1;",
    "/* #__PURE__ */\nconst value = 1;",
    "/* @__PURE__ */\nconst value = 1;",
    "/* #__NO_SIDE_EFFECTS__ */\nconst value = 1;",
    "/* @__NO_SIDE_EFFECTS__ */\nconst value = 1;",
  ];

  for (const code of cases) assert.deepEqual(commentMessages(code), [], code);
});

test("matches directives only in syntax accepted by their owning tools", () => {
  const valid = [
    "/* @ts-ignore */\nconst value: string = 1;",
    "/** @ts-expect-error */\nconst value: string = 1;",
    "/* eslint-disable-next-line no-console */\nconsole.log('value');",
    "/*\n * biome-ignore lint/style/useConst: generated protocol shape\n */\nlet value = 1;",
    "/* c8 ignore next */\nconst value = 1;",
    "/* @vite-ignore */\nimport(path);",
    "/* webpackChunkName: 'catalog' */\nconst value = 1;",
    "/* #__PURE__ */\nconst value = factory();",
    "/*# sourceMappingURL=subject.js.map */\nconst value = 1;",
  ];
  const invalid = [
    "//! @ts-ignore\nconst value: string = 1;",
    "/*! @ts-ignore */\nconst value: string = 1;",
    "/*\n * @ts-ignore\n */\nconst value: string = 1;",
    '/*/ <reference types="node" /> */\nexport {};',
    '/* /// <reference types="node" /> */\nexport {};',
    "//! eslint-disable-next-line no-console\nconsole.log('value');",
    "/*! eslint-disable-next-line no-console */\nconsole.log('value');",
    "/*! biome-ignore lint/style/useConst: generated protocol shape */\nlet value = 1;",
    "/*! c8 ignore next */\nconst value = 1;",
    "// @vite-ignore\nimport(path);",
    "/*! webpackChunkName: 'catalog' */\nconst value = 1;",
    "// #__PURE__\nconst value = factory();",
    "/*! #__PURE__ */\nconst value = factory();",
    "/*!# sourceMappingURL=subject.js.map */\nconst value = 1;",
  ];

  for (const code of valid) assert.deepEqual(commentMessages(code), [], code);
  for (const code of invalid) assert.equal(commentMessages(code).length, 1, code);
});

test("allows legal headers only before code", () => {
  const headers = [
    "// SPDX-License-Identifier: MIT",
    "/* @license MIT */",
    "/*!\n * @preserve bundled notice\n */",
    "// Copyright (c) 2026 Acme",
  ];

  for (const header of headers) {
    assert.deepEqual(commentMessages(`${header}\nconst value = 1;`), [], header);
  }

  assertLocations(commentMessages("const value = 1;\n// SPDX-License-Identifier: MIT"), [[2, 2]]);
});

test("rejects directive and legal near misses", () => {
  const cases = [
    '//// <reference types="node" />\nconst value = 1;',
    '/// <reference types="node" /> appended prose\nconst value = 1;',
    '/// <reference path="./types.d.ts" preserve="false" />\nconst value = 1;',
    'const value = 1;\n/// <reference types="node" />',
    "const value = 1;\n// @ts-check",
    "// @ts-ignore because this is prose\nconst value = 1;",
    "// eslint-disable no-console extra prose\nconst value = 1;",
    "// biome-ignore lint/style/useConst\nconst value = 1;",
    "// istanbul ignore everything\nconst value = 1;",
    "// # sourceMappingURL=subject.js.map extra\nconst value = 1;",
    "// @vite-ignore prose\nconst value = 1;",
    "// webpackIgnore: maybe\nconst value = 1;",
    "// webpackChunkName: true\nconst value = 1;",
    "// #__PURE__ extra\nconst value = 1;",
    "// @licensed MIT\nconst value = 1;",
    "// Copyrighted by Acme\nconst value = 1;",
  ];

  for (const code of cases) assert.equal(commentMessages(code).length, 1, code);
});

test("does not let an adjacent directive or legal header exempt prose", () => {
  const directiveGroup = commentMessages(
    "// eslint-disable-next-line no-console\n// This prose is not a directive.\nconst value = 1;",
  );
  const legalGroup = commentMessages(
    "// SPDX-License-Identifier: MIT\n// This prose is not legal text.\nconst value = 1;",
  );

  assertLocations(directiveGroup, [[1, 2]]);
  assertLocations(legalGroup, [[1, 2]]);
});
