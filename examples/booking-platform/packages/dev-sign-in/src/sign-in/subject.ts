export const subjectOf = (name: string): string =>
  // One name, one login: case and spacing do not make a new person.
  `dev:${name.trim().toLowerCase().replace(/\s+/gu, "-")}`;
