import path from "node:path";

const extensions = new Map([
  [".sh", "shell"],
  [".bash", "shell"],
  [".py", "python"],
  [".yml", "yaml"],
  [".yaml", "yaml"],
  [".toml", "toml"],
  [".css", "css"],
]);

export function languageFor(file) {
  const base = path.basename(file);
  if (/^(?:Dockerfile|Containerfile)(?:\..+)?$/u.test(base) && !base.endsWith(".dockerignore"))
    return "docker";
  if (/^.+\.(?:Dockerfile|Containerfile)$/u.test(base)) return "docker";
  return extensions.get(path.extname(file).toLowerCase());
}

function shebang(comment, language, line, raw) {
  if (line !== 1 || !raw.startsWith("#!") || !["shell", "python"].includes(language)) return false;
  const executable = language === "shell" ? "(?:ba|da|k|z)?sh" : "python(?:[23](?:\\.\\d+)?)?";
  const valueOptions = language === "shell" ? "[oO]" : "[XW]";
  const args = String.raw`(?:\s+(?:-${valueOptions}\s+[\w.:=,+-]+|-[\w=-]+))*`;
  const direct = new RegExp(`^!/(?:[\\w.-]+/)*${executable}${args}$`, "u");
  const env = new RegExp(`^!/(?:usr/)?bin/env\\s+(?:-S\\s+)?${executable}${args}$`, "u");
  return direct.test(comment.value.trim()) || env.test(comment.value.trim());
}

function codingCookie(value, line, lines) {
  if (line > 2 || (line === 2 && !/^\s*(?:#.*)?$/u.test(lines[0]))) return false;
  return /^(?:coding[:=]\s*[-\w.]+|-\*-\s*coding[:=]\s*[-\w.]+\s*;?\s*-\*-|(?:vim|vi|ex):\s*(?:set\s+)?(?:fileencoding|fenc)=[-\w.]+\s*:?)$/u.test(
    value,
  );
}

function dockerDirective(value) {
  return (
    /^syntax=[\w./:@-]+$/u.test(value) ||
    /^escape=[`\\]$/u.test(value) ||
    /^check=(?:skip=(?:all|[A-Z][\w]*(?:,[A-Z][\w]*)*)(?:;error=(?:true|false))?|error=(?:true|false))$/u.test(
      value,
    )
  );
}

export function classifyException(comment, language, line, codeStarted, lines, state) {
  const value = comment.value.trim();
  if (comment.multiline) return { exempt: false, invalid: true };
  const legal =
    /^SPDX-License-Identifier:\s*\S+(?:\s+WITH\s+\S+)?$/u.test(value) ||
    /^@(?:license|preserve)\b/u.test(value) ||
    /^copyright(?:\s|\(|©)/iu.test(value);
  if (legal && !codeStarted) return { exempt: true };
  if (shebang(comment, language, line, lines[line - 1])) return { exempt: true, executable: true };
  if (language === "docker" && /^(?:syntax|escape|check)=/iu.test(value)) {
    const key = value.split("=")[0];
    const exempt = state.dockerLeading && dockerDirective(value) && !state.dockerKeys.has(key);
    state.dockerKeys.add(key);
    return { exempt, invalid: !exempt };
  }
  let exempt = false;
  if (language === "shell") exempt = /^shellcheck\s+disable=SC\d+(?:,SC\d+)*$/u.test(value);
  if (language === "python")
    exempt =
      codingCookie(value, line, lines) ||
      /^noqa(?::\s*[A-Z]+\d+(?:,\s*[A-Z]+\d+)*)?$/u.test(value) ||
      /^type:\s*ignore(?:\[[\w.,-]+\])?$/u.test(value) ||
      /^pyright:\s*(?:ignore|strict|basic|standard|off)(?:\[[\w.,-]+\])?$/u.test(value);
  if (language === "yaml") exempt = /^yaml-language-server:\s*\$schema=\S+$/u.test(value);
  if (language === "docker") exempt = /^hadolint\s+ignore=DL\d+(?:,DL\d+)*$/u.test(value);
  if (language === "css")
    exempt =
      /^eslint-(?:disable(?:-next-line|-line)?|enable)(?:\s+[\w/-]+(?:\s*,\s*[\w/-]+)*)?$/u.test(
        value,
      ) || /^#\s*sourceMappingURL=\S+$/u.test(value);
  return { exempt };
}
