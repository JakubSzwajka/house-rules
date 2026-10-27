import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

export function assertReadMetadata({ Schema, contract }) {
  const {
    WorkItem,
    WorkItemFailure,
    WorkItemFilters,
    WorkItemList,
    WorkItemPermissions,
    WorkItemRef,
    WorkItemsCallerDenied,
    WorkItemsOperations: operations,
    WorkItemTree,
  } = contract;
  const expected = {
    get: ["Read one visible work item.", Schema.Struct({ id: Schema.NonEmptyString }), WorkItem],
    getForSystem: [
      "Read one work item as the system without person access checks.",
      Schema.Struct({ id: Schema.NonEmptyString }),
      WorkItem,
    ],
    list: [
      "List visible work items with filters and an exclusive cursor.",
      WorkItemFilters,
      WorkItemList,
    ],
    tree: [
      "Read a container's work item hierarchy.",
      Schema.Struct({ container: Schema.NullOr(WorkItemRef) }),
      Schema.Array(WorkItemTree),
    ],
  };
  for (const [name, [description, input, output]] of Object.entries(expected)) {
    const { input: actualInput, output: actualOutput, failure, ...metadata } = operations[name];
    assert.deepEqual(metadata, {
      name: `WorkItems.${name}`,
      kind: "operation",
      description,
      permission:
        name === "getForSystem" ? WorkItemPermissions.systemRead : WorkItemPermissions.read,
      readOnly: true,
      destructive: false,
      transactional: false,
      needsApproval: false,
      edges: [],
    });
    assert.deepEqual(actualInput.ast, input.ast);
    assert.deepEqual(actualOutput.ast, output.ast);
    if (name === "getForSystem") {
      assert.deepEqual(failure.members, [WorkItemFailure, WorkItemsCallerDenied]);
    } else {
      assert.equal(failure, WorkItemFailure);
    }
    assert.ok(Object.isFrozen(operations[name]));
    assert.ok(Object.isFrozen(operations[name].edges));
  }
  assert.equal(operations.get.input, operations.getForSystem.input);
  assert.equal(operations.get.output, WorkItem);
  assert.equal(operations.getForSystem.output, WorkItem);
  assert.equal(operations.list.input, WorkItemFilters);
  assert.equal(operations.list.output, WorkItemList);
}

export async function verifyReadMetadata({ ESLint, houseRules, featuresConfig, root }) {
  const put = (file, code) => {
    const target = path.join(root, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, code);
    return target;
  };
  put("pnpm-workspace.yaml", 'packages:\n  - "apps/*"\n  - "packages/*"\n');
  put("apps/api/package.json", '{"name":"@metadata/api","private":true,"type":"module"}');
  put(
    "packages/process/package.json",
    '{"name":"@metadata/process","type":"module","exports":{"./contract":"./src/contract.ts"}}',
  );
  put(
    "packages/process/src/contract.ts",
    `import { defineOperation } from "@house-rules/domain/contract";
import { WorkItemsOperations, WorkItemFailure, WorkItemRef, WorkItemTree } from "@house-rules/work-items/contract";
import { Schema } from "effect";
export const tree = defineOperation("BoardRead.tree", {
  description: "Read a work item tree through a process edge.",
  input: Schema.Struct({ container: Schema.NullOr(WorkItemRef) }),
  output: Schema.Array(WorkItemTree),
  failure: WorkItemFailure,
  permission: null,
  readOnly: true,
  edges: [WorkItemsOperations.tree],
});
`,
  );
  const eslint = new ESLint({
    cwd: root,
    overrideConfigFile: true,
    overrideConfig: [...houseRules.configs.recommended, ...featuresConfig()],
  });
  const failures = [];
  for (const [name, target, rejected = false] of [
    ["get", "WorkItemsOperations.get"],
    ["getForSystem", "WorkItemsOperations.getForSystem"],
    ["list", "WorkItemsOperations.list"],
    ["tree", "WorkItemsOperations.tree"],
    ["transitive", "tree"],
    ["write", "WorkItemsOperations.create", true],
    ["unresolved", "WorkItemsOperations.missing", true],
  ]) {
    const file = put(
      `apps/api/src/read-models/${name}/index.ts`,
      `import { defineReadModel } from "@house-rules/application/contract";
import { WorkItemsOperations } from "@house-rules/work-items/contract";
${name === "transitive" ? 'import { tree } from "@metadata/process/contract";\n' : ""}export const query = defineReadModel("board_${name}", {
  description: "Read work items from the public contract.",
  input: ${target}.input,
  output: ${target}.output,
  failure: ${target}.failure,
  permission: null,
  ${name === "getForSystem" ? 'start: { kind: "system", reason: "Read metadata proof", startedBy: "test" },\n  ' : ""}edges: [${target}],
  handler: (input, { call }) => call(${target}, input),
});
`,
    );
    const [result] = await eslint.lintFiles([file]);
    const expected = rejected
      ? result.messages.length === 1 &&
        result.messages[0].ruleId === "house-rules/feature-builders" &&
        result.messages[0].messageId === "readEdges" &&
        result.messages[0].severity === 2
      : result.messages.length === 0;
    console.log(
      `physical WorkItems ${expected ? "PASS" : "FAIL"}: ${name}${rejected ? " rejected" : " accepted"}`,
    );
    if (!expected) failures.push({ name, messages: result.messages });
  }
  const endpoints = put(
    "apps/api/src/ways-in/http/endpoints.ts",
    `import { endpoint } from "@house-rules/application/contract";
import { query as get } from "../../read-models/get/index.ts";
import { query as getForSystem } from "../../read-models/getForSystem/index.ts";
import { query as list } from "../../read-models/list/index.ts";
import { query as tree } from "../../read-models/tree/index.ts";
import { query as transitive } from "../../read-models/transitive/index.ts";
export const reads = {
  get: endpoint(get),
  getForSystem: endpoint(getForSystem),
  list: endpoint(list),
  tree: endpoint(tree),
  transitive: endpoint(transitive),
};
`,
  );
  const [exposure] = await eslint.lintFiles([endpoints]);
  assert.deepEqual(exposure.messages, [], "real read models expose directly as endpoints");
  assert.deepEqual(failures, [], "public WorkItems edges must retain fail-closed read proof");
}
