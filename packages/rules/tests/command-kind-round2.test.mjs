import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { it } from "node:test";
import { ESLint } from "eslint";
import houseRules from "@house-rules/rules";
import { verifyRoundTwo } from "./command-kind-round2-fixture.mjs";

it("recommended alone checks physical round two graphs below an ancestor src", async () => {
  const root = path.join(mkdtempSync(path.join(tmpdir(), "command-kind-r2-")), "src/consumer");
  await verifyRoundTwo({ ESLint, houseRules, root });
});
