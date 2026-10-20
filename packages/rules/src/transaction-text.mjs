import { blankSql, sqlTexts } from "./sql-text.mjs";

const STARTS_TRANSACTION = /(?:^|;)\s*(begin|start\s+transaction)\b/iu;
const SQL_TAG = /[\w$]*sql[\w$]*\s*$/iu;
const RAW_QUERY_CALL = /\.\s*(?:unsafe|execute|executeUnprepared|executeRaw|query)\s*\(\s*$/u;
const STARTS_WITH_TRANSACTION = /^\s*(?:begin|start\s+transaction)\b/iu;
const WHOLE_TRANSACTION_STRING =
  /^\s*(?:begin|BEGIN|start\s+transaction|START\s+TRANSACTION)(?:\s+(?:transaction|work|isolation|read|TRANSACTION|WORK|ISOLATION|READ)\b[^;]*)?\s*;?\s*$/u;

export const firstMatch = (parts, pattern) => {
  for (const part of parts) {
    const match = pattern.exec(part.text);
    if (match !== null) return part.start + match.index;
  }
  return undefined;
};

export const firstTransactionStart = ({ strings, code }, inNode) => {
  const codeBefore = new Map(code.map((part) => [part.start + part.text.length, part.text]));
  const before = (part) => codeBefore.get(part.start - 1) ?? "";
  const isQuery = (part) => SQL_TAG.test(before(part)) || RAW_QUERY_CALL.test(before(part));
  const seen = new Set();
  const tagged = new Set();
  for (const part of strings) {
    if (part.template === undefined || seen.has(part.template)) continue;
    seen.add(part.template);
    if (isQuery(part)) tagged.add(part.template);
  }
  const isSql = (part) => (part.template === undefined ? isQuery(part) : tagged.has(part.template));
  for (const { raw, at } of sqlTexts(strings.filter(isSql))) {
    const match = STARTS_TRANSACTION.exec(
      blankSql(raw, { dollarQuotes: true, identifiers: false }),
    );
    if (match !== null) return at[match.index + match[0].length - match[1].length];
  }
  return inNode
    ? firstMatch(strings, STARTS_WITH_TRANSACTION)
    : firstMatch(
        strings.filter((part) => !isSql(part)),
        WHOLE_TRANSACTION_STRING,
      );
};
