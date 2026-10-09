export const SITE_URL = "https://stack.kubaszwajka.com";
export const RULES_PAGE_URL = `${SITE_URL}/rules/`;

// The site's rules page links here: never change a published anchor
export const ruleAnchor = (id) =>
  /^[A-Za-z][A-Za-z0-9-]*$/u.test(id)
    ? id
    : id
        .toLowerCase()
        .replace(/[^a-z0-9]+/gu, "-")
        .replace(/^-|-$/gu, "");

export const ruleDocsUrl = (id) => `${RULES_PAGE_URL}#${ruleAnchor(id)}`;

export const seeRuleLine = (id) => `See ${ruleDocsUrl(id)}`;
