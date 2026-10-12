import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { parse } from "yaml";

const parseWorkflow = (source) => parse(source, { strict: true, uniqueKeys: true });
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const PUBLISH_IF =
  "(github.event_name == 'push' && startsWith(github.ref, 'refs/tags/@house-rules/')) || (github.event_name == 'workflow_dispatch' && inputs.publish == true && github.ref == 'refs/heads/main')";

const MAIN_ONLY_NAME = "Manual publish runs only on main";
const MAIN_ONLY_RUN = [
  'if [ "$EVENT" = workflow_dispatch ] && [ "$PUBLISH" = true ] && [ "$REF" != refs/heads/main ]; then',
  '  echo "A manual publish runs only on refs/heads/main, not ${REF}." >&2',
  "  exit 1",
  "fi",
  "",
].join("\n");
const VERIFY_RUNS = [
  "pnpm check",
  "pnpm test",
  "pnpm build",
  "pnpm run packed-consumer",
  "pnpm publish -r --access public --dry-run --no-git-checks",
];

const stepsOf = (job) => job.steps ?? [];
const runsOf = (job) =>
  stepsOf(job)
    .map((step) => step.run)
    .filter((run) => typeof run === "string");

function assertPublishWorkflow(workflow) {
  const { jobs } = workflow;
  assert.deepEqual(Object.keys(jobs).sort(), ["publish", "verify"]);
  assert.deepEqual(workflow.permissions, { contents: "read" });
  assert.deepEqual(Object.keys(workflow.on).sort(), ["pull_request", "push", "workflow_dispatch"]);
  assert.deepEqual(workflow.on.push, { tags: ["@house-rules/*@*"] });
  assert.deepEqual(Object.keys(workflow.on.workflow_dispatch.inputs), ["publish"]);
  assert.equal(workflow.on.workflow_dispatch.inputs.publish.type, "boolean");
  assert.equal(workflow.on.workflow_dispatch.inputs.publish.default, false);
  assert.ok(
    !JSON.stringify(workflow.env ?? {}).includes("secrets."),
    "workflow-level env reads a secret",
  );

  const { publish, verify } = jobs;
  assert.deepEqual(verify.permissions, { contents: "read" }, "verify runs on pull requests");
  assert.equal(verify.if, undefined, "verify runs on every trigger");
  assert.doesNotMatch(
    JSON.stringify(verify),
    /secrets\.|id-token|NODE_AUTH_TOKEN|NPM_TOKEN|registry-url/u,
  );
  for (const run of runsOf(verify).filter((line) => /pnpm publish/u.test(line))) {
    assert.match(run, /--dry-run/u);
    assert.doesNotMatch(run, /--provenance/u);
  }

  assert.equal(verify["continue-on-error"], undefined, "verify may not fail softly");
  const gate = stepsOf(verify)[0];
  assert.equal(gate?.name, MAIN_ONLY_NAME, "verify starts with the main-only gate");
  assert.equal(gate.if, undefined, "the main-only gate always runs");
  assert.equal(gate["continue-on-error"], undefined);
  assert.deepEqual(gate.env, {
    EVENT: "${{ github.event_name }}",
    PUBLISH: "${{ inputs.publish }}",
    REF: "${{ github.ref }}",
  });
  assert.equal(gate.run, MAIN_ONLY_RUN, "the gate compares github.ref exactly, in the shell");

  const verification = stepsOf(verify).filter((step) => VERIFY_RUNS.includes(step.run));
  assert.deepEqual(
    verification.map((step) => step.run),
    VERIFY_RUNS,
    "verify runs check, test, build, packed-consumer and the dry run, once each, in that order",
  );
  for (const step of verification) {
    assert.equal(step.if, undefined, `${step.run} may not be conditional`);
    assert.equal(step["continue-on-error"], undefined, `${step.run} may not fail softly`);
  }
  assert.equal(
    stepsOf(verify).at(-1).run,
    VERIFY_RUNS.at(-1),
    "the dry run is the last verify step",
  );

  assert.equal(publish.needs, "verify");
  assert.equal(
    publish.if,
    PUBLISH_IF,
    "publish is gated on a package tag push or a manual run on main",
  );
  assert.deepEqual(publish.permissions, { contents: "read", "id-token": "write" });
  const real = stepsOf(publish).filter((step) => /pnpm publish/u.test(step.run ?? ""));
  assert.equal(real.length, 1);
  assert.doesNotMatch(real[0].run, /--dry-run/u);
  assert.equal(real[0].env?.NODE_AUTH_TOKEN, "${{ secrets.NPM_TOKEN }}");
  const reads = stepsOf(publish).filter((step) => JSON.stringify(step).includes("secrets."));
  assert.deepEqual(reads, real, "only the publish step reads a secret");

  // A job a pull_request can trigger is any job whose `if` is absent or names pull_request.
  for (const [name, job] of Object.entries(jobs)) {
    const reachable = job.if === undefined || /pull_request/u.test(job.if);
    if (!reachable) continue;
    const text = JSON.stringify(job);
    assert.doesNotMatch(text, /secrets\./u, `${name} can run on a pull request and reads a secret`);
    assert.notEqual(
      job.permissions?.["id-token"],
      "write",
      `${name} can run on a pull request and gets id-token: write`,
    );
    assert.equal(job.permissions?.contents, "read", `${name} must pin contents: read`);
  }
}

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
        "pnpm publish -r --access public --provenance --no-git-checks",
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
