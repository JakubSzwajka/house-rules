import assert from "node:assert/strict";
import { parse } from "yaml";

export const parseWorkflow = (source) => parse(source, { strict: true, uniqueKeys: true });

export const PUBLISH_IF =
  "(github.event_name == 'push' && startsWith(github.ref, 'refs/tags/@house-rules/')) || (github.event_name == 'workflow_dispatch' && inputs.publish == true && github.ref == 'refs/heads/main')";

export const TAG_RUN = [
  'auth="$(printf \'x-access-token:%s\' "$GITHUB_TOKEN" | base64 -w0)"',
  'echo "::add-mask::$auth"',
  "GIT_CONFIG_COUNT=1 \\",
  "GIT_CONFIG_KEY_0=http.https://github.com/.extraheader \\",
  'GIT_CONFIG_VALUE_0="AUTHORIZATION: basic $auth" \\',
  "  node scripts/tag-published.mjs",
  "",
].join("\n");

const MAIN_ONLY_NAME = "Manual publish runs only on main";
const MAIN_ONLY_RUN = [
  'if [ "$EVENT" = workflow_dispatch ] && [ "$PUBLISH" = true ] && [ "$REF" != refs/heads/main ]; then',
  '  echo "A manual publish runs only on refs/heads/main, not ${REF}." >&2',
  "  exit 1",
  "fi",
  "",
].join("\n");
export const PR_PATHS = [
  "scripts/packed-*.mjs",
  "scripts/tarball-content.mjs",
  "scripts/tag-published.mjs",
  "tests/publish-workflow*.mjs",
  "tests/tag-published*.mjs",
  ".github/workflows/publish.yml",
];

export const VERIFY_RUNS = [
  "pnpm check",
  "pnpm test",
  "pnpm build",
  "pnpm run packed-consumer",
  "pnpm publish -r --access public --dry-run --no-git-checks",
];

const stepsOf = (job) => job.steps ?? [];
export const runsOf = (job) =>
  stepsOf(job)
    .map((step) => step.run)
    .filter((run) => typeof run === "string");

export function assertPublishWorkflow(workflow) {
  const { jobs } = workflow;
  assert.deepEqual(Object.keys(jobs).sort(), ["publish", "verify"]);
  assert.deepEqual(workflow.permissions, { contents: "read" });
  assert.deepEqual(Object.keys(workflow.on).sort(), ["pull_request", "push", "workflow_dispatch"]);
  assert.deepEqual(workflow.on.push, { tags: ["@house-rules/*@*"] });
  assert.deepEqual(workflow.on.pull_request, { paths: PR_PATHS });
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
  assert.deepEqual(stepsOf(verify).find((step) => step.run === "pnpm test").env, {
    TURBO_CONCURRENCY: "2",
  });
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
  assert.deepEqual(publish.permissions, { contents: "write", "id-token": "write" });
  const real = stepsOf(publish).filter((step) => /pnpm publish/u.test(step.run ?? ""));
  assert.equal(real.length, 1);
  assert.doesNotMatch(real[0].run, /--dry-run/u);
  assert.equal(real[0].env?.NODE_AUTH_TOKEN, "${{ secrets.NPM_TOKEN }}");
  assert.equal(
    real[0].run,
    "pnpm publish -r --access public --provenance --no-git-checks --report-summary",
  );
  const checkout = stepsOf(publish).find((step) => step.uses?.startsWith("actions/checkout@"));
  assert.deepEqual(checkout.with, { "fetch-depth": 0, "persist-credentials": false });
  const tagging = stepsOf(publish).filter((step) => step.name === "Tag published packages");
  assert.equal(tagging.length, 1);
  assert.equal(
    tagging[0].run,
    TAG_RUN,
    "tagging authenticates only its command, without persisting a token",
  );
  assert.deepEqual(tagging[0].env, { GITHUB_TOKEN: "${{ github.token }}" });
  assert.equal(
    stepsOf(publish).indexOf(tagging[0]),
    stepsOf(publish).indexOf(real[0]) + 1,
    "tagging immediately follows publish",
  );
  assert.equal(stepsOf(publish).at(-1), tagging[0], "tagging follows the successful publish");
  assert.equal(tagging[0].if, undefined, "tagging uses the default success guard");
  assert.equal(tagging[0]["continue-on-error"], undefined);
  assert.equal(real[0]["continue-on-error"], undefined);
  const reads = stepsOf(publish).filter((step) => JSON.stringify(step).includes("secrets."));
  assert.deepEqual(reads, real, "only the publish step reads an npm secret");
  const tokenReads = stepsOf(publish).filter((step) =>
    /github\.token|GITHUB_TOKEN/u.test(JSON.stringify(step)),
  );
  assert.deepEqual(tokenReads, tagging, "only tagging receives the write token");
  assert.doesNotMatch(JSON.stringify(publish.env ?? {}), /github\.token|GITHUB_TOKEN/u);
  assert.doesNotMatch(JSON.stringify(workflow.env ?? {}), /github\.token|GITHUB_TOKEN/u);

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
