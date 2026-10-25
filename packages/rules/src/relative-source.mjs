import * as fs from "node:fs";
import path from "node:path";

export const relativeSource = (file, source) => {
  if (!source.startsWith(".")) return undefined;
  const base = path.resolve(path.dirname(file), source);
  const candidates = [
    base,
    base.replace(/\.[cm]?js$/u, ".ts"),
    ...[".ts", ".tsx", ".mts", ".cts", "/index.ts"].map((suffix) => base + suffix),
  ];
  return candidates.find((candidate) => {
    try {
      return fs.statSync(candidate).isFile();
    } catch {
      return false;
    }
  });
};
