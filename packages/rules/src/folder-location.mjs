import * as fs from "node:fs";
import path from "node:path";

const inside = (parent, target) => {
  const relative = path.relative(parent, target);
  return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative);
};

export const migrationsLocationProblem = (directory, folder = "migrations") => {
  try {
    const migrations = path.resolve(directory, folder);
    if (fs.lstatSync(migrations).isSymbolicLink())
      return "migrations/ must be its own directory, not a symlink.";
    if (!inside(fs.realpathSync(directory), fs.realpathSync(migrations)))
      return "migrations/ resolves outside its own module.";
    if (!fs.statSync(directory).isDirectory() || !fs.statSync(migrations).isDirectory())
      return "migrations/ is not a directory.";
    for (const entry of fs.readdirSync(migrations, { withFileTypes: true })) {
      if (entry.name.endsWith(".sql") && entry.isSymbolicLink())
        return `migration file ${entry.name} must not be a symlink.`;
    }
    return undefined;
  } catch {
    return "cannot resolve its own migrations/ directory.";
  }
};
