export const objectProperty = (resolve, file, object, name, seen = new Set()) => {
  if (seen.has(object)) return undefined;
  const next = new Set([...seen, object]);
  const matches = [];
  for (const item of object.properties) {
    if (item.type === "SpreadElement") {
      const spread = resolve(file, item.argument);
      if (spread?.node?.type !== "ObjectExpression") return false;
      const member = objectProperty(resolve, spread.file, spread.node, name, next);
      if (member === false) return false;
      if (member !== undefined) matches.push(member);
    } else if (item.type !== "Property" || item.computed || item.kind !== "init") return false;
    else if ((item.key.name ?? item.key.value) === name) matches.push(resolve(file, item.value));
  }
  return matches.length === 1 ? matches[0] : matches.length === 0 ? undefined : false;
};
