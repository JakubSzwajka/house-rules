export const yamlString = (value: string): string => JSON.stringify(value);

export const isRelativeTarget = (target: string): boolean =>
  target !== "" &&
  !target.startsWith("#") &&
  !target.startsWith("//") &&
  !/^[a-z][a-z0-9+.-]*:/i.test(target) &&
  !target.includes("{");

export const splitTarget = (target: string): { readonly path: string; readonly hash: string } => {
  const index = target.search(/[#?]/);
  return index === -1
    ? { path: target, hash: "" }
    : { path: target.slice(0, index), hash: target.slice(index) };
};
