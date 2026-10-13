import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { recoverPublished, tagPublished } from "../scripts/tag-published.mjs";
import {
  capability,
  migrations,
  head,
  metadata,
  provenance,
  provenanceUrl,
  repository,
  recoveryOptions,
  fakeGit,
} from "./tag-published-fixtures.mjs";

describe("tags for published packages", () => {
  it("tags and pushes only the packages in pnpm\'s successful publish report", () => {
    const { git, calls } = fakeGit();
    const tags = ["@house-rules/capability@0.15.0", "@house-rules/migrations@0.3.0"];
    assert.deepEqual(tagPublished({ publishedPackages: [capability, migrations] }, git), tags);
    assert.deepEqual(
      calls.filter(([command, option]) => command === "tag" && option !== "--list"),
      tags.map((tag) => ["tag", tag, head]),
    );
    assert.deepEqual(calls.at(-1), [
      "push",
      "--atomic",
      "origin",
      ...tags.map((tag) => `refs/tags/${tag}`),
    ]);
  });

  it("accepts the Node Host in a successful report", () => {
    const { git } = fakeGit();
    assert.deepEqual(
      tagPublished(
        { publishedPackages: [{ name: "@house-rules/node-host", version: "0.1.0" }] },
        git,
      ),
      ["@house-rules/node-host@0.1.0"],
    );
  });

  it("does nothing when no package was published", () => {
    const { git, calls } = fakeGit();
    assert.deepEqual(tagPublished({ publishedPackages: [] }, git), []);
    assert.deepEqual(calls, []);
  });

  it("leaves an existing triggering tag alone when it points at HEAD", () => {
    const { git, calls } = fakeGit({ "@house-rules/capability@0.15.0": head });
    assert.deepEqual(tagPublished({ publishedPackages: [capability, migrations] }, git), [
      "@house-rules/migrations@0.3.0",
    ]);
    assert.deepEqual(calls.at(-1), [
      "push",
      "--atomic",
      "origin",
      "refs/tags/@house-rules/capability@0.15.0",
      "refs/tags/@house-rules/migrations@0.3.0",
    ]);
  });

  it("refuses to move an existing tag on another commit, before any write", () => {
    const { git, calls } = fakeGit({ "@house-rules/capability@0.15.0": "b".repeat(40) });
    assert.throws(
      () => tagPublished({ publishedPackages: [migrations, capability] }, git),
      /another commit/u,
    );
    assert.ok(
      !calls.some(
        ([command, option]) => command === "push" || (command === "tag" && option !== "--list"),
      ),
    );
  });

  it("recovers after publish succeeded, tagging failed, and the rerun publishes nothing", async () => {
    const { git, calls } = fakeGit();
    const packages = [capability, migrations];
    const registry = metadata;
    let fail = true;
    const failingGit = (args) => {
      const result = git(args);
      if (args[0] === "push" && fail) {
        fail = false;
        throw new Error("push failed");
      }
      return result;
    };
    assert.throws(() => tagPublished({ publishedPackages: packages }, failingGit), /push failed/u);
    assert.deepEqual(tagPublished({ publishedPackages: [] }, git), []);
    const before = calls.length;
    assert.deepEqual(await recoverPublished(packages, git, registry, recoveryOptions), []);
    assert.ok(!calls.slice(before).some(([cmd, option]) => cmd === "tag" && option !== "--list"));
    assert.deepEqual(calls.at(-1), [
      "push",
      "--atomic",
      "origin",
      "refs/tags/@house-rules/capability@0.15.0",
      "refs/tags/@house-rules/migrations@0.3.0",
    ]);
  });

  it("recovers missing tags without a summary, including a partial publish", async () => {
    const { git, calls } = fakeGit();
    assert.deepEqual(
      await recoverPublished(
        [capability, migrations],
        git,
        (pkg) => (pkg === capability ? metadata(pkg) : undefined),
        recoveryOptions,
      ),
      ["@house-rules/capability@0.15.0"],
    );
    assert.deepEqual(calls.at(-1), [
      "push",
      "--atomic",
      "origin",
      "refs/tags/@house-rules/capability@0.15.0",
    ]);
  });

  it("skips versions whose provenance source is not HEAD, ignoring gitHead", async () => {
    const { git, calls } = fakeGit();
    assert.deepEqual(
      await recoverPublished([capability], git, (pkg) => ({ ...metadata(pkg), gitHead: head }), {
        attestations: async () => provenance("b".repeat(40)),
      }),
      [],
    );
    assert.deepEqual(calls, [["rev-parse", "HEAD"]]);
  });

  it("dry-runs matching versions without git writes, even with an existing tag", async () => {
    const { git, calls } = fakeGit({ "@house-rules/capability@0.15.0": head });
    const reports = [];
    assert.deepEqual(
      await recoverPublished([capability, migrations], git, metadata, {
        ...recoveryOptions,
        dryRun: true,
        report: (line) => reports.push(line),
      }),
      ["@house-rules/migrations@0.3.0"],
    );
    assert.equal(reports.length, 2);
    assert.match(reports[0], new RegExp(`capability@0.15.0 commit ${head}`, "u"));
    assert.ok(
      calls.every(([cmd, option]) => cmd === "rev-parse" || (cmd === "tag" && option === "--list")),
    );
  });

  it("dry-run still rejects conflicting tags before any write", async () => {
    const { git, calls } = fakeGit({ "@house-rules/capability@0.15.0": "b".repeat(40) });
    await assert.rejects(
      recoverPublished([capability], git, metadata, { ...recoveryOptions, dryRun: true }),
      /another commit/u,
    );
    assert.ok(
      !calls.some(([cmd, option]) => cmd === "push" || (cmd === "tag" && option !== "--list")),
    );
  });

  it("refuses mismatched npm metadata and registry outages before any write", async () => {
    for (const registry of [
      (pkg) => ({ ...metadata(pkg), name: "@other/app" }),
      (pkg) => ({ ...metadata(pkg), version: "99.0.0" }),
      (pkg) => {
        if (pkg === migrations) throw new Error("registry unavailable");
        return metadata(pkg);
      },
    ]) {
      const { git, calls } = fakeGit();
      await assert.rejects(
        recoverPublished([capability, migrations], git, registry, recoveryOptions),
      );
      assert.deepEqual(calls, [["rev-parse", "HEAD"]]);
    }
  });

  it("fails on absent or unreadable attestations before tagging an earlier match", async () => {
    for (const broken of [
      async () => ({}),
      async () => ({ attestations: [] }),
      async () => ({ attestations: [{ bundle: { dsseEnvelope: { payload: "not base64" } } }] }),
      async () => {
        throw new Error("fetch failed");
      },
      async () =>
        provenance(head, (s) => {
          s.predicate.buildDefinition.externalParameters.workflow.repository = `${repository}-fake`;
        }),
      async () =>
        provenance(head, (s) => {
          s.predicate.buildDefinition.resolvedDependencies[0].uri = `git+${repository}-fake@main`;
        }),
    ]) {
      const { git, calls } = fakeGit();
      let fetched = 0;
      await assert.rejects(
        recoverPublished([capability, migrations], git, metadata, {
          attestations: async (url) => {
            assert.equal(url, provenanceUrl);
            return fetched++ === 0 ? provenance() : broken();
          },
        }),
      );
      assert.deepEqual(calls, [["rev-parse", "HEAD"]]);
    }
    for (const dist of [undefined, {}, { attestations: {} }, { attestations: { url: "" } }]) {
      const { git, calls } = fakeGit();
      await assert.rejects(recoverPublished([capability], git, (pkg) => ({ ...pkg, dist })));
      assert.deepEqual(calls, [["rev-parse", "HEAD"]]);
    }
  });

  it("fails closed on missing, foreign, duplicate or invalid report entries", () => {
    for (const summary of [
      {},
      { publishedPackages: [{ name: "@other/app", version: "1.0.0" }] },
      { publishedPackages: [{ ...capability, version: "latest" }] },
      { publishedPackages: [capability, capability] },
    ]) {
      const { git, calls } = fakeGit();
      assert.throws(() => tagPublished(summary, git));
      assert.deepEqual(calls, []);
    }
  });
});
