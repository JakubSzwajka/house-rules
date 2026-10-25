const adoptShapeProblem = (label, adopt) => {
  const integers = (value) => Array.isArray(value) && value.every(Number.isInteger);
  return typeof adopt === "object" &&
    adopt !== null &&
    !Array.isArray(adopt) &&
    typeof adopt.from === "string" &&
    integers(adopt.ids) &&
    (adopt.rehash === undefined || integers(adopt.rehash))
    ? undefined
    : `${label}: "adopt" must be { "from": "<table>", "ids": [<integer>], "rehash"?: [<integer>] }.`;
};

export const shapeProblem = (label, entry) => {
  if (typeof entry !== "object" || entry === null || Array.isArray(entry))
    return `${label} must be an object.`;
  if (Object.hasOwn(entry, "folder"))
    return `${label}: "folder" locations are not supported; domain modules are packages.`;
  for (const key of ["workspace", "package"]) {
    if (entry[key] !== undefined && typeof entry[key] !== "string")
      return `${label} "${key}" must be a string.`;
  }
  const named = ["workspace", "package"].filter((key) => entry[key] !== undefined);
  if (named.length !== 1) return `${label} must name exactly one of "workspace" or "package".`;
  if (entry[named[0]].trim() === "") return `${label} "${named[0]}" must not be empty.`;
  if (
    (entry.name !== undefined && typeof entry.name !== "string") ||
    (entry.table !== undefined && typeof entry.table !== "string")
  )
    return `${label}: "name" and "table" must be strings.`;
  return entry.adopt === undefined ? undefined : adoptShapeProblem(label, entry.adopt);
};
