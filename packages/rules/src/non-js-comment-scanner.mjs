function hashBoundary(line, index, language) {
  const prefix = line.slice(0, index);
  if (language === "docker") return prefix.trim() === "";
  if (language === "yaml") return index === 0 || /\s/u.test(line[index - 1]);
  if (language === "shell") return index === 0 || /[\s;&|()]/u.test(line[index - 1]);
  return true;
}

function startsQuote(line, index, language) {
  if (language !== "yaml") return true;
  const prefix = line.slice(0, index);
  return /^\s*(?:[-?]\s+)*$/u.test(prefix) || /[:[{,]\s*$/u.test(prefix);
}

export function scanLine(line, language, state) {
  const comments = [];
  let quote = state.quote ?? null;
  let ansiC = state.ansiC ?? false;
  let codeText = "";
  let arithmetic = state.arithmetic ?? 0;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (language === "css" && state.block) {
      const end = line.indexOf("*/", index);
      if (end < 0) break;
      state.block = false;
      index = end + 1;
      continue;
    }
    if (quote) {
      codeText += "x";
      const literal = !ansiC && quote[0] === "'" && ["shell", "toml", "yaml"].includes(language);
      if (char === "\\" && !literal) {
        index += 1;
      } else if (line.startsWith(quote, index)) {
        if (language === "yaml" && quote === "'" && line[index + 1] === "'") index += 1;
        else {
          index += quote.length - 1;
          quote = null;
          ansiC = false;
        }
      }
      continue;
    }
    if (language === "css" && line.startsWith("/*", index)) {
      const end = line.indexOf("*/", index + 2);
      comments.push({
        value: line.slice(index + 2, end < 0 ? undefined : end),
        multiline: end < 0,
      });
      if (end < 0) {
        state.block = true;
        break;
      }
      index = end + 1;
      continue;
    }
    if (language === "shell" && line.startsWith("$'", index)) {
      quote = "'";
      ansiC = true;
      codeText += "x";
      index += 1;
      continue;
    }
    if ((char === '"' || char === "'") && startsQuote(line, index, language)) {
      quote =
        ["python", "toml"].includes(language) && line.startsWith(char.repeat(3), index)
          ? char.repeat(3)
          : char;
      codeText += "x";
      index += quote.length - 1;
      continue;
    }
    if (char === "#" && language !== "css" && hashBoundary(line, index, language)) {
      comments.push({ value: line.slice(index + 1) });
      break;
    }
    if (language === "shell") {
      if (char === "\\") {
        codeText += "x";
        index += 1;
        continue;
      }
      if (arithmetic || line.startsWith("((", index)) {
        if (char === "(") arithmetic += 1;
        if (char === ")") arithmetic -= 1;
      } else if (line.startsWith("<<<", index)) {
        codeText += "<<<";
        index += 2;
        continue;
      } else if (line.startsWith("<<", index)) {
        const match = /^<<(-)?\s*(['"]?)([\w.-]+)\2(?=$|[\s;&|)])/u.exec(line.slice(index));
        if (match) state.heredoc = { delimiter: match[3], tabs: Boolean(match[1]) };
      }
    }
    codeText += char;
  }
  state.quote = quote && (quote.length === 3 || language === "shell") ? quote : null;
  state.ansiC = ansiC;
  state.arithmetic = arithmetic;
  const code = codeText.trim().length > 0;
  return { comments: comments.map((comment) => ({ ...comment, inline: code })), code, codeText };
}

export function skipData(line, language, state) {
  if (language === "yaml" && state.yamlIndent !== undefined) {
    const indent = line.match(/^ */u)[0].length;
    if (line.trim() === "" || indent > state.yamlIndent) return true;
    state.yamlIndent = undefined;
  }
  if (language === "shell" && state.heredoc) {
    const { delimiter, tabs } = state.heredoc;
    if ((tabs ? line.replace(/^\t*/u, "") : line) === delimiter) state.heredoc = undefined;
    return true;
  }
  return false;
}
