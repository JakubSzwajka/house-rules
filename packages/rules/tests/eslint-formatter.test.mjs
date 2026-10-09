import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ESLint } from "eslint";
import formatter from "../src/eslint-formatter.mjs";
import plugin from "../src/index.mjs";

const message = (ruleId, line) => ({
  ruleId,
  severity: 2,
  message: `${ruleId} failed`,
  line,
  column: 1,
});
const file = (filePath, messages) => ({
  filePath,
  messages,
  errorCount: messages.length,
  warningCount: 0,
  fatalErrorCount: 0,
  fixableErrorCount: 0,
  fixableWarningCount: 0,
});

const rulesMeta = {
  "house-rules/comment-discipline": plugin.rules["comment-discipline"].meta,
  "house-rules/no-hand-run-effect": plugin.rules["no-hand-run-effect"].meta,
  "no-unused-vars": { docs: { url: "https://eslint.org/docs/latest/rules/no-unused-vars" } },
};
const context = { cwd: "/work", rulesMeta };

const stylish = async (results) =>
  (await new ESLint().loadFormatter("stylish")).format(results, context);

describe("house ESLint formatter", () => {
  it("prints stylish output, then one See line per failing house rule", async () => {
    const results = [
      file("/work/a.ts", [
        message("house-rules/comment-discipline", 1),
        message("house-rules/comment-discipline", 5),
      ]),
      file("/work/b.ts", [message("no-unused-vars", 2)]),
    ];
    const output = await formatter(results, context);
    const base = await stylish(results);
    assert.ok(output.startsWith(base));
    assert.equal(
      output.slice(base.length),
      "\nSee https://stack.kubaszwajka.com/rules/#comment-discipline  (house-rules/comment-discipline)\n",
    );
  });

  it("prints one See line per owned rule across two files, in order of first failure", async () => {
    const results = [
      file("/work/a.ts", [
        message("house-rules/no-hand-run-effect", 3),
        message("no-unused-vars", 4),
        message("house-rules/no-hand-run-effect", 9),
      ]),
      file("/work/b.ts", [
        message("house-rules/comment-discipline", 1),
        message("house-rules/no-hand-run-effect", 2),
      ]),
    ];
    const output = await formatter(results, context);
    const base = await stylish(results);
    assert.ok(output.startsWith(base));
    assert.equal(
      output.slice(base.length),
      [
        "",
        "See https://stack.kubaszwajka.com/rules/#no-hand-run-effect  (house-rules/no-hand-run-effect)",
        "See https://stack.kubaszwajka.com/rules/#comment-discipline  (house-rules/comment-discipline)",
        "",
      ].join("\n"),
    );
    assert.equal(output.match(/^See /gm)?.length, 2);
    assert.equal(await formatter(results, context), output);
  });

  it("is identical to stylish for a clean result", async () => {
    const results = [file("/work/a.ts", [])];
    assert.equal(await formatter(results, context), await stylish(results));
  });

  it("is identical to stylish when only third-party rules fail", async () => {
    const results = [file("/work/b.ts", [message("no-unused-vars", 2)])];
    assert.equal(await formatter(results, context), await stylish(results));
  });
});
