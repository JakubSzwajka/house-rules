import { COMMENT_DISCIPLINE_MESSAGE } from "./comment-discipline.mjs";
import { scanLine, skipData } from "./non-js-comment-scanner.mjs";
import { classifyException, languageFor } from "./non-js-comment-syntax.mjs";

export { languageFor } from "./non-js-comment-syntax.mjs";

export function checkNonJsComments(file, source) {
  const language = languageFor(file);
  if (!language) return [];
  const lines = source.split(/\r\n|\n|\r/u);
  const state = { dockerLeading: true, dockerKeys: new Set() };
  let codeStarted = false;
  const records = [];
  const codeLines = [];
  for (let index = 0; index < lines.length; index += 1) {
    const current = lines[index];
    if (skipData(current, language, state)) {
      codeLines.push(true);
      continue;
    }
    const scanned = scanLine(current, language, state);
    if (
      language === "yaml" &&
      /(?:^\s*-|:)\s*[|>](?:[+-][1-9]?|[1-9][+-]?)?\s*$/u.test(scanned.codeText)
    )
      state.yamlIndent = current.match(/^ */u)[0].length;
    codeLines.push(scanned.code);
    const lineNumber = index + 1;
    const comments = scanned.comments
      .map((comment) => ({
        ...comment,
        ...classifyException(comment, language, lineNumber, codeStarted, lines, state),
      }))
      .filter((comment) => !comment.executable);
    if (comments.length)
      records.push({ line: lineNumber, comments, code: scanned.code, codeStarted });
    if (scanned.code) codeStarted = true;
    if (
      language === "docker" &&
      (scanned.code ||
        !comments.length ||
        comments.some(
          (comment) => !comment.exempt || !/^(?:syntax|escape|check)=/u.test(comment.value.trim()),
        ))
    )
      state.dockerLeading = false;
  }
  const groups = [];
  for (const record of records) {
    const prior = groups.at(-1);
    if (prior && prior.lastLine === record.line - 1 && !prior.hasCode && !record.code) {
      prior.lastLine = record.line;
      prior.records.push(record);
    } else
      groups.push({
        line: record.line,
        lastLine: record.line,
        hasCode: record.code,
        records: [record],
      });
  }
  return groups.flatMap((group) => {
    const comments = group.records.flatMap((record) => record.comments);
    const diagnostic = [{ file, line: group.line, message: COMMENT_DISCIPLINE_MESSAGE }];
    if (comments.some((comment) => comment.multiline || comment.invalid)) return diagnostic;
    if (group.records.some((record) => record.comments.length > 1)) return diagnostic;
    if (comments.every((comment) => comment.exempt)) return [];
    if (comments.some((comment) => comment.inline) && comments.length === 1) return [];
    const record = group.records[0];
    const nextIndex = group.lastLine;
    const sameIndent =
      lines[group.line - 1].match(/^\s*/u)?.[0] === lines[nextIndex]?.match(/^\s*/u)?.[0];
    const directlyBeforeCode =
      group.records.length === 1 &&
      record.codeStarted &&
      lines[nextIndex]?.trim() !== "" &&
      codeLines[nextIndex] &&
      sameIndent;
    if (directlyBeforeCode && comments.every((comment) => !comment.exempt)) return [];
    return diagnostic;
  });
}
