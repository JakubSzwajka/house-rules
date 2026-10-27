import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { it } from "node:test";
import { ESLint } from "eslint";
import houseRules from "@house-rules/rules";
import { verifyRoundThree } from "./command-kind-round3-fixture.mjs";

it("recommended alone closes the scoped round three physical routes", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "command-kind-r3-"));
  await verifyRoundThree({ ESLint, houseRules, root });
});
