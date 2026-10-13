import { readFileSync } from "node:fs";

export const capability = { name: "@house-rules/capability", version: "0.16.0" };
export const migrations = { name: "@house-rules/migrations", version: "0.3.0" };
export const head = "a".repeat(40);
export const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/npm-attestations.json", import.meta.url)),
);
export const provenanceType = "https://slsa.dev/provenance/v1";
export const repository = "https://github.com/JakubSzwajka/house-rules";
export const provenanceUrl = "https://registry.npmjs.org/-/npm/v1/attestations/test";
export const metadata = (pkg) => ({ ...pkg, dist: { attestations: { url: provenanceUrl } } });

export function provenance(commit = head, change = () => {}) {
  const json = structuredClone(fixture);
  for (const attestation of json.attestations) {
    const envelope = attestation.bundle.dsseEnvelope;
    const statement = JSON.parse(Buffer.from(envelope.payload, "base64").toString("utf8"));
    if (statement.predicateType !== provenanceType) continue;
    statement.predicate.buildDefinition.resolvedDependencies[0].digest.gitCommit = commit;
    change(statement);
    envelope.payload = Buffer.from(JSON.stringify(statement)).toString("base64");
  }
  return json;
}

export const recoveryOptions = { attestations: async () => provenance() };

export function fakeGit(existing = {}) {
  const calls = [];
  const git = (args) => {
    calls.push(args);
    if (args.join(" ") === "rev-parse HEAD") return head;
    if (args[0] === "tag" && args[1] === "--list")
      return existing[args[2]] === undefined ? "" : args[2];
    if (args[0] === "rev-parse") {
      return existing[args[1].replace(/^refs\/tags\//u, "").replace(/\^\{commit\}$/u, "")];
    }
    if (args[0] === "tag") existing[args[1]] = args[2];
    return "";
  };
  return { git, calls };
}
