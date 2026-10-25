const reserved = /\b(?:standard_conforming_strings|backslash_quote|set_config|pg_settings)\b/giu;

export const sqlSettingsProblems = (_statements, text) =>
  [...text.matchAll(reserved)].map(
    (match) =>
      `SQL reserves ${match[0]}: standard_conforming_strings, backslash_quote, set_config and pg_settings are forbidden anywhere in module migration/read-model SQL`,
  );
