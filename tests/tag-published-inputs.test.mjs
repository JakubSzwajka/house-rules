import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { describe, it } from "node:test";
import {
  commitFromAttestations,
  fetchAttestations,
  npmVersion,
  readPublishSummary,
  workspacePackages,
} from "../scripts/tag-published.mjs";
import {
  application,
  fixture,
  head,
  metadata,
  provenance,
  provenanceUrl,
} from "./tag-published-fixtures.mjs";

describe("npm provenance attestations", () => {
  it("reads the real npm fixture's SLSA source, not its publish predicate", () => {
    assert.equal(commitFromAttestations(fixture), "f844b8220793cae5ed2740de33b5a3ee2bd1e044");
  });

  it("rejects missing, ambiguous, foreign and malformed source provenance", () => {
    for (const change of [
      (s) => {
        s.predicateType = "https://example.com/not-slsa";
      },
      (s) => {
        s.predicate.buildDefinition.resolvedDependencies = [];
      },
      (s) => {
        s.predicate.buildDefinition.resolvedDependencies[0].digest.gitCommit = "bad";
      },
      (s) => {
        const dependencies = s.predicate.buildDefinition.resolvedDependencies;
        dependencies.push(structuredClone(dependencies[0]));
      },
      (s) => {
        s.predicate.buildDefinition.externalParameters.workflow.repository =
          "https://github.com/other/house-rules";
      },
    ])
      assert.throws(() => commitFromAttestations(provenance(head, change)));
    const duplicate = provenance();
    duplicate.attestations.push(duplicate.attestations.at(-1));
    assert.throws(() => commitFromAttestations(duplicate));
  });

  it("fetches the attestation URL and fails on HTTP, network and JSON errors", async () => {
    assert.deepEqual(
      await fetchAttestations(provenanceUrl, async (url, options) => {
        assert.equal(url, provenanceUrl);
        assert.ok(options.signal instanceof AbortSignal);
        return { ok: true, json: async () => fixture };
      }),
      fixture,
    );
    for (const fetcher of [
      async () => ({ ok: false, status: 404 }),
      async () => {
        throw new Error("network down");
      },
      async () => ({
        ok: true,
        json: async () => {
          throw new SyntaxError("invalid JSON");
        },
      }),
    ])
      await assert.rejects(fetchAttestations(provenanceUrl, fetcher));
  });
});

describe("publish report and recovery inputs", () => {
  it("fails on a missing report with a recovery hint", () => {
    assert.throws(
      () =>
        readPublishSummary(() => {
          throw Object.assign(new Error("missing"), { code: "ENOENT" });
        }),
      /--recover at the release commit/u,
    );
  });

  it("exits nonzero when the workflow tagging command has no summary", () => {
    assert.throws(
      () =>
        execFileSync(
          process.execPath,
          [new URL("../scripts/tag-published.mjs", import.meta.url).pathname],
          { cwd: new URL("./fixtures/", import.meta.url), stdio: "pipe" },
        ),
      (error) => {
        assert.equal(error.status, 1);
        assert.match(
          error.stderr.toString(),
          /No publish summary.*--recover at the release commit/u,
        );
        return true;
      },
    );
  });

  it("reads a report but does not hide malformed JSON or file permission failures", () => {
    assert.deepEqual(
      readPublishSummary(() => '{"publishedPackages":[]}'),
      { publishedPackages: [] },
    );
    assert.throws(() => readPublishSummary(() => "not json"), SyntaxError);
    const denied = Object.assign(new Error("denied"), { code: "EACCES" });
    assert.throws(
      () =>
        readPublishSummary(() => {
          throw denied;
        }),
      (error) => error === denied,
    );
  });

  it("loads only the seven public workspace manifests, without the summary", () => {
    const files = [];
    const packages = workspacePackages((file) => {
      files.push(file);
      const folder = file.split("/")[1];
      return JSON.stringify({ name: `@house-rules/${folder}`, version: "1.0.0" });
    });
    assert.deepEqual(
      files,
      ["rules", "domain", "application", "migrations", "call-audit", "comments", "node-host"].map(
        (folder) => `packages/${folder}/package.json`,
      ),
    );
    assert.equal(packages.length, 7);
    assert.throws(() => workspacePackages(() => JSON.stringify({ name: "@other/app" })));
    assert.throws(() =>
      workspacePackages((file) =>
        JSON.stringify({ name: `@house-rules/${file.split("/")[1]}`, private: true }),
      ),
    );
  });

  it("skips absent historical manifests but refuses every other manifest failure", () => {
    const historical = (file) => {
      if (file === "packages/comments/package.json")
        throw Object.assign(new Error("absent historical manifest"), { code: "ENOENT" });
      const folder = file.split("/")[1];
      return JSON.stringify({ name: `@house-rules/${folder}`, version: "1.0.0" });
    };
    const packages = workspacePackages(historical);
    assert.equal(packages.length, 6);
    assert.ok(!packages.some(({ name }) => name === "@house-rules/comments"));
    for (const source of [
      "not json",
      JSON.stringify({ name: "@house-rules/rules", version: "latest" }),
    ])
      assert.throws(() => workspacePackages(() => source));
    for (const code of ["EACCES", "EISDIR"]) {
      const denied = Object.assign(new Error(code), { code });
      assert.throws(
        () =>
          workspacePackages(() => {
            throw denied;
          }),
        (error) => error === denied,
      );
    }
  });

  it("queries npm for an exact version on the public registry", () => {
    const published = metadata(application);
    assert.deepEqual(
      npmVersion(application, (command, args, options) => {
        assert.equal(command, "npm");
        assert.deepEqual(args, [
          "view",
          "@house-rules/application@0.1.0",
          "--json",
          "--registry=https://registry.npmjs.org",
        ]);
        assert.equal(options.encoding, "utf8");
        return JSON.stringify(published);
      }),
      published,
    );
  });

  it("treats only npm's E404 as unpublished, not outages or malformed responses", () => {
    for (const code of ["E404", "E503", "E401"]) {
      const error = Object.assign(new Error(code), { stdout: JSON.stringify({ error: { code } }) });
      const npm = () => {
        throw error;
      };
      if (code === "E404") assert.equal(npmVersion(application, npm), undefined);
      else
        assert.throws(
          () => npmVersion(application, npm),
          (caught) => caught === error,
        );
    }
    const error = Object.assign(new Error("network down"), { stdout: "not json" });
    assert.throws(
      () =>
        npmVersion(application, () => {
          throw error;
        }),
      (caught) => caught === error,
    );
    assert.throws(() => npmVersion(application, () => "not json"), SyntaxError);
  });
});
