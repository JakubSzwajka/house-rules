import type { MapPlug } from "./app-map-snapshot.ts";
import type { MeanKey } from "./registry.ts";

export const plugSockets: readonly string[] = [
  "Who",
  "May",
  "Mean",
  "Record",
  "Authenticator",
  "ActorResolver",
  "Approval",
  "CallWatch",
  "EventSource",
];
const perWay = new Set(["Who", "Mean"]);
const appLevel = new Set(["May", "Record", "EventSource"]);

export type PlugWay = Readonly<{ name: string; mean?: MeanKey }> &
  (
    | Readonly<{ protocol: "hook"; slot: string }>
    | Readonly<{ protocol: "http" | "mcp" | "schedule" | "event" }>
  );
type PlugIssue = Readonly<{ path: string; reason: string }>;

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const sorted = (plug: MapPlug): MapPlug =>
  plug.ways === undefined ? plug : { ...plug, ways: [...plug.ways].sort(compare) };
const same = (a: MapPlug, b: MapPlug): boolean =>
  JSON.stringify([a.name, a.package ?? null, a.fills, sorted(a).ways ?? null]) ===
  JSON.stringify([b.name, b.package ?? null, b.fills, sorted(b).ways ?? null]);

type Kind = "socket" | "slot";
type Entry = Readonly<{ plug: MapPlug; kind: Kind }>;

const derivedPlugs = (ways: readonly PlugWay[]): Entry[] => [
  ...(["allow", "elicitation", "no"] as const).flatMap((key): Entry[] => {
    const names = ways
      .filter((way) => way.mean === key)
      .map((way) => way.name)
      .sort(compare);
    return names.length === 0
      ? []
      : [
          {
            plug: {
              name: `Mean.${key}`,
              package: "@house-rules/application",
              fills: "Mean",
              ways: names,
            },
            kind: "socket",
          },
        ];
  }),
  ...ways.flatMap((way): Entry[] =>
    way.protocol === "hook"
      ? [{ plug: { name: `hook:${way.name}`, fills: way.slot, ways: [way.name] }, kind: "slot" }]
      : [],
  ),
];

export const mergePlugs = (
  ways: readonly PlugWay[],
  declared: readonly MapPlug[],
): Readonly<{ plugs: MapPlug[]; issues: PlugIssue[] }> => {
  const issues: PlugIssue[] = [];
  const derived = derivedPlugs(ways);
  const entries = [...derived];
  const paths = new Map<string, string>();
  const slots = new Set(ways.flatMap((way) => (way.protocol === "hook" ? [way.slot] : [])));
  for (const [index, plug] of declared.entries()) {
    const path = `plugs[${index}]`;
    const issue = (field: string, reason: string): void => {
      issues.push({ path: field === "" ? path : `${path}.${field}`, reason });
    };
    if (plug.name.trim() === "") issue("name", "Blank plug name");
    const seen = paths.get(plug.name);
    if (seen !== undefined) {
      issue("name", `Duplicate plug name ${plug.name} (also ${seen})`);
      continue;
    }
    paths.set(plug.name, path);
    const twin = derived.find((each) => each.plug.name === plug.name);
    if (twin === undefined && plug.name.startsWith("hook:"))
      issue("name", `${plug.name} uses the hook: prefix, which only hook ways derive`);
    // A twin keeps its derived kind; any other plug fills a socket when one has that name.
    const kind: Kind | undefined =
      twin?.kind ??
      (plugSockets.includes(plug.fills) ? "socket" : slots.has(plug.fills) ? "slot" : undefined);
    if (kind === undefined)
      issue("fills", `${plug.name} fills ${plug.fills}, which is no socket, port or hook way slot`);
    const socket = kind === "socket";
    const hook = kind === "slot";
    for (const [k, name] of (plug.ways ?? []).entries()) {
      const way = ways.find((each) => each.name === name);
      if (way === undefined) issue(`ways[${k}]`, `${plug.name} names unknown way ${name}`);
      else if (plug.ways?.indexOf(name) !== k)
        issue(`ways[${k}]`, `${plug.name} names way ${name} twice`);
      else if (socket && plug.fills === "Who" && way.protocol !== "http" && way.protocol !== "mcp")
        issue(`ways[${k}]`, `${plug.name} fills Who on ${name}, which is not an HTTP or MCP way`);
      else if (hook && (way.protocol !== "hook" || way.slot !== plug.fills))
        issue(`ways[${k}]`, `${plug.name} fills ${plug.fills}, which ${name} does not hook`);
    }
    if (((socket && perWay.has(plug.fills)) || hook) && (plug.ways ?? []).length === 0)
      issue("ways", `${plug.name} fills ${plug.fills} and must name its ways`);
    if (socket && appLevel.has(plug.fills) && plug.ways !== undefined)
      issue("ways", `${plug.name} fills app-level ${plug.fills} and must not name ways`);
    // Declared plugs are review facts; only an exact twin of a derived plug merges into it.
    if (twin === undefined) {
      if (kind !== undefined) entries.push({ plug: sorted(plug), kind });
    } else if (!same(twin.plug, plug))
      issue("", `${plug.name} differs from the plug the app derives`);
  }
  // Runs despite earlier issues so every cheap issue is reported together.
  const filled = new Map<string, string>();
  for (const { plug, kind } of entries)
    for (const way of new Set(plug.ways !== undefined && plug.ways.length > 0 ? plug.ways : [""])) {
      // Kind keeps a hook slot keyed "Mean" apart from the Mean socket; past bug.
      const key = `${kind}\u0000${plug.fills}\u0000${way}`;
      const prior = filled.get(key);
      if (prior === undefined) filled.set(key, plug.name);
      else
        issues.push({
          path: paths.get(plug.name) ?? "plugs",
          reason: `${prior} and ${plug.name} both fill ${plug.fills}${way === "" ? "" : ` on ${way}`}`,
        });
    }
  const plugs = entries.map((entry) => entry.plug);
  return { plugs: plugs.sort((a, b) => compare(a.name, b.name)), issues };
};
