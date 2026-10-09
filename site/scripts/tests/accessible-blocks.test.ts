import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { focusableCodeBlocks } from "../accessible-blocks.ts";

const label = (language: string, groupIndex: number): unknown => {
  const pre = { tagName: "pre", properties: {}, children: [] };
  focusableCodeBlocks.hooks.postprocessRenderedBlock({
    renderData: { blockAst: { tagName: "div", children: [pre] } },
    codeBlock: { language, parentDocument: { positionInDocument: { groupIndex } } },
  });
  return pre.properties;
};

describe("focusable code blocks", () => {
  it("give each block in a page its own region name", () => {
    const names = [label("sh", 0), label("sh", 1), label("text", 2)].map(
      (properties) => (properties as Record<string, unknown>)["aria-label"],
    );
    assert.deepEqual(names, ["Code block 1, sh", "Code block 2, sh", "Code block 3, text"]);
  });

  it("keep the block focusable as a region", () => {
    assert.deepEqual(label("sh", 0), {
      tabindex: 0,
      role: "region",
      "aria-label": "Code block 1, sh",
    });
  });
});
