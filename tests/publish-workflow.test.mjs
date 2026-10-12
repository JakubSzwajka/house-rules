import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  assertPublishWorkflow,
  parseWorkflow,
  PUBLISH_IF,
  runsOf,
  VERIFY_RUNS,
} from "./publish-workflow-assertions.mjs";

const stepsOf = (job) => job.steps ?? [];
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("publish workflow", () => {
  const workflow = () => parseWorkflow(read(".github/workflows/publish.yml"));

  it("splits a read-only verify job from a gated publish job", () => {
    assertPublishWorkflow(workflow());
  });

  it("runs the checks and the packed consumer before it dry-runs", () => {
    const runs = runsOf(workflow().jobs.verify);
    for (const command of ["pnpm check", "pnpm test", "pnpm build", "pnpm run packed-consumer"]) {
      assert.ok(runs.includes(command), `verify misses ${command}`);
    }
    assert.ok(runs.includes("pnpm publish -r --access public --dry-run --no-git-checks"));
    assert.deepEqual(
      runs.filter((run) => VERIFY_RUNS.includes(run)),
      VERIFY_RUNS,
    );
    assert.ok(
      runsOf(workflow().jobs.publish).includes(
        "pnpm publish -r --access public --provenance --no-git-checks --report-summary",
      ),
    );
  });

  it("pins every action to a full commit SHA", () => {
    for (const job of Object.values(workflow().jobs)) {
      for (const step of stepsOf(job).filter((entry) => entry.uses !== undefined)) {
        assert.match(step.uses, /@[0-9a-f]{40}$/u, step.uses);
      }
    }
  });

  const breaks = {
    "publish cannot push tags": (w) => {
      w.jobs.publish.permissions.contents = "read";
    },
    "verify can push tags": (w) => {
      w.jobs.verify.permissions.contents = "write";
    },
    "tagging is removed": (w) => {
      w.jobs.publish.steps.pop();
    },
    "tagging runs even after publish failure": (w) => {
      w.jobs.publish.steps.at(-1).if = "always()";
    },
    "publish fails softly": (w) => {
      w.jobs.publish.steps.find((step) => step.name === "Publish")["continue-on-error"] = true;
    },
    "checkout persists the write token": (w) => {
      w.jobs.publish.steps[0].with["persist-credentials"] = true;
    },
    "checkout falls back to persisting credentials": (w) => {
      delete w.jobs.publish.steps[0].with["persist-credentials"];
    },
    "checkout receives an explicit write token": (w) => {
      w.jobs.publish.steps[0].with.token = "${{ github.token }}";
    },
    "tag pushes use a PAT that could retrigger workflows": (w) => {
      w.jobs.publish.steps.at(-1).env.GITHUB_TOKEN = "${{ secrets.TAG_TOKEN }}";
    },
    "install receives the write token": (w) => {
      w.jobs.publish.steps.find((step) => step.run === "pnpm install --frozen-lockfile").env = {
        GITHUB_TOKEN: "${{ github.token }}",
      };
    },
    "the job receives the write token": (w) => {
      w.jobs.publish.env = { GITHUB_TOKEN: "${{ github.token }}" };
    },
    "the workflow receives the write token": (w) => {
      w.env.GITHUB_TOKEN = "${{ github.token }}";
    },
    "tagging persists auth in git config": (w) => {
      w.jobs.publish.steps.at(-1).run =
        'git config http.https://github.com/.extraheader "$GITHUB_TOKEN"';
    },
    "tagging fails softly": (w) => {
      w.jobs.publish.steps.at(-1)["continue-on-error"] = true;
    },
    "tagging loses the published-package report": (w) => {
      const step = w.jobs.publish.steps.find((step) => step.name === "Publish");
      step.run = step.run.replace(" --report-summary", "");
    },
    "id-token: write on verify": (w) => {
      w.jobs.verify.permissions["id-token"] = "write";
    },
    "id-token: write at the workflow level": (w) => {
      w.permissions["id-token"] = "write";
    },
    "the publish job loses its if guard": (w) => {
      delete w.jobs.publish.if;
    },
    "the publish job runs on pull_request": (w) => {
      w.jobs.publish.if = `github.event_name == 'pull_request' || ${PUBLISH_IF}`;
    },
    "a manual run publishes from any branch": (w) => {
      w.jobs.publish.if = PUBLISH_IF.replace(" && github.ref == 'refs/heads/main'", "");
    },
    "the publish job stops waiting for verify": (w) => {
      delete w.jobs.publish.needs;
    },
    "the main-only gate is removed": (w) => {
      w.jobs.verify.steps.shift();
    },
    "the main-only gate becomes conditional": (w) => {
      w.jobs.verify.steps[0].if = "github.event_name == 'workflow_dispatch'";
    },
    "the main-only gate compares case-insensitively": (w) => {
      w.jobs.verify.steps[0].run = w.jobs.verify.steps[0].run.replace(
        '"$REF" != refs/heads/main',
        '"${REF,,}" != refs/heads/main',
      );
    },
    "the main-only gate loses its failing exit": (w) => {
      w.jobs.verify.steps[0].run = w.jobs.verify.steps[0].run.replace("exit 1", "exit 0");
    },
    "the main-only gate reads the ref through an expression": (w) => {
      w.jobs.verify.steps[0].env.REF = "${{ github.ref == 'refs/heads/main' }}";
    },
    "the main-only gate fails softly": (w) => {
      w.jobs.verify.steps[0]["continue-on-error"] = true;
    },
    "verify fails softly": (w) => {
      w.jobs.verify["continue-on-error"] = true;
    },
    "the verify check step is skipped": (w) => {
      w.jobs.verify.steps.find((step) => step.run === "pnpm check").if = "false";
    },
    "the verify test step fails softly": (w) => {
      w.jobs.verify.steps.find((step) => step.run === "pnpm test")["continue-on-error"] = true;
    },
    "the verify build step is removed": (w) => {
      w.jobs.verify.steps = w.jobs.verify.steps.filter((step) => step.run !== "pnpm build");
    },
    "the packed consumer is removed": (w) => {
      w.jobs.verify.steps = w.jobs.verify.steps.filter(
        (step) => step.run !== "pnpm run packed-consumer",
      );
    },
    "the dry run is removed": (w) => {
      w.jobs.verify.steps.pop();
    },
    "the dry run runs before the checks": (w) => {
      w.jobs.verify.steps.splice(1, 0, w.jobs.verify.steps.pop());
    },
    "the tests run before the check": (w) => {
      const { steps } = w.jobs.verify;
      const at = steps.findIndex((step) => step.run === "pnpm check");
      [steps[at], steps[at + 1]] = [steps[at + 1], steps[at]];
    },
    "verify reads NPM_TOKEN": (w) => {
      w.jobs.verify.steps.at(-1).env = { NODE_AUTH_TOKEN: "${{ secrets.NPM_TOKEN }}" };
    },
    "verify publishes for real": (w) => {
      w.jobs.verify.steps.at(-1).run =
        "pnpm publish -r --access public --provenance --no-git-checks";
    },
    "pull_request_target joins the triggers": (w) => {
      w.on.pull_request_target = {};
    },
    "a third job gets id-token: write": (w) => {
      w.jobs.extra = { permissions: { contents: "read", "id-token": "write" }, steps: [] };
    },
  };
  for (const [name, mutate] of Object.entries(breaks)) {
    it(`rejects: ${name}`, () => {
      const broken = structuredClone(workflow());
      mutate(broken);
      assert.throws(() => assertPublishWorkflow(broken));
    });
  }
});

describe("workflow parser", () => {
  const source = () => read(".github/workflows/publish.yml");
  const withSecretEnv = (text, key) =>
    text.replace(
      /^env:\n {2}TURBO_TELEMETRY_DISABLED: "1"$/mu,
      `${key}:\n  TURBO_TELEMETRY_DISABLED: "1"\n  NODE_AUTH_TOKEN: \${{ secrets.NPM_TOKEN }}`,
    );

  it("catches a workflow-level secret behind a plain env key", () => {
    const text = withSecretEnv(source(), "env");
    assert.notEqual(text, source());
    assert.throws(() => assertPublishWorkflow(parseWorkflow(text)), /reads a secret/u);
  });

  it("catches a workflow-level secret behind an escaped env key", () => {
    const text = withSecretEnv(source(), '"\\u0065nv"');
    assert.match(text, /^"\\u0065nv":$/mu);
    assert.deepEqual(Object.keys(parseWorkflow(text)).includes("env"), true);
    assert.throws(() => assertPublishWorkflow(parseWorkflow(text)), /reads a secret/u);
  });

  it("catches a main-only gate whose check was emptied", () => {
    const text = source().replace(
      /if \[ "\$EVENT" = workflow_dispatch.*\n.*\n.*exit 1\n.*fi\n/u,
      "true\n",
    );
    assert.notEqual(text, source());
    assert.throws(
      () => assertPublishWorkflow(parseWorkflow(text)),
      /compares github\.ref exactly/u,
    );
  });

  for (const [name, text] of Object.entries({
    "an unterminated quote": 'name: "open\njobs: {}\n',
    "a duplicate key": "on: push\non: pull_request\n",
    "an unsupported block header": "run: |@\n  text\n",
    "a tab indent": "jobs:\n\tverify: {}\n",
  })) {
    it(`refuses ${name}`, () => {
      assert.throws(() => parseWorkflow(text));
    });
  }
});
