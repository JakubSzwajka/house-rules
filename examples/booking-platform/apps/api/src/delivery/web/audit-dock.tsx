import { type ActivityEntry, activityWindow, type MyActivity } from "@example/activity/contract";
import {
  ChevronUpIcon,
  InfoIcon,
  RefreshCwIcon,
  SquareCheckIcon,
  SquareIcon,
  TerminalIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "./components/ui/badge.js";
import { Button } from "./components/ui/button.js";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./components/ui/collapsible.js";
import { keyOf, type Trail, withNewest, withOlder } from "./audit-trail.js";
import { ProblemAlert } from "./problem-alert.js";
import { clockAt, type Member, stampAt } from "./session.js";
import { useCall } from "./use-call.js";

type Props = Readonly<{ member: Member | null; pageCalls: number }>;

const openKey = "stays.under-the-hood.open";
const readsKey = "stays.audit-dock.include-reads";

const storedFlag = (key: string): boolean => {
  try {
    return globalThis.localStorage.getItem(key) === "true";
  } catch {
    return false;
  }
};

const storeFlag = (key: string, value: boolean): void => {
  try {
    globalThis.localStorage.setItem(key, String(value));
  } catch {
    // Private mode or a full store: the dock still works, it just forgets.
  }
};

const fields = (entry: ActivityEntry): string =>
  JSON.stringify({ ...entry, recordedAtLocal: stampAt(entry.recordedAt) }, null, 2);

function EntryRow({ entry }: Readonly<{ entry: ActivityEntry }>) {
  return (
    <li className="border-b">
      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" className="h-auto w-full flex-wrap justify-start">
            <span className="text-xs text-muted-foreground">{clockAt(entry.recordedAt)}</span>
            <span className="min-w-40 flex-1 truncate text-left text-xs">{entry.capability}</span>
            <Badge variant={entry.outcome === "success" ? "secondary" : "destructive"}>
              {entry.outcome}
            </Badge>
            <span className="w-10 text-left text-xs">{entry.kind ?? "-"}</span>
            <span className="w-10 text-left text-xs text-muted-foreground">
              {entry.channel ?? "-"}
            </span>
            <span className="w-32 truncate text-left text-xs">{entry.targetId ?? "-"}</span>
            <span className="w-14 text-right text-xs text-muted-foreground">
              {entry.durationMs} ms
            </span>
            <span className="w-24 truncate text-left text-xs text-muted-foreground">
              {entry.requestId ?? ""}
            </span>
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <pre className="mx-4 mb-3 rounded-md bg-muted p-2 text-xs whitespace-pre-wrap wrap-anywhere">
            {fields(entry)}
          </pre>
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}

function TrailEnd({
  trail,
  loading,
  onOlder,
}: Readonly<{ trail: Trail; loading: boolean; onOlder: () => void }>) {
  if (trail.next !== null) {
    return (
      <div className="p-3">
        <Button variant="outline" size="sm" disabled={loading} onClick={onOlder}>
          {loading ? "Loading older…" : "Load older"}
        </Button>
      </div>
    );
  }
  return (
    <p className="p-4 text-xs text-muted-foreground">
      {trail.moreBeyondWindow
        ? `That is as far back as this list reaches: your newest ${activityWindow} calls. The server keeps older ones.`
        : "That is everything the audit kept for you."}
    </p>
  );
}

function SignedOutBar() {
  return (
    <div className="flex h-12 items-center gap-2 px-4 text-sm">
      <TerminalIcon className="size-4" />
      <span>Sign in to see your audit trail</span>
    </div>
  );
}

export function AuditDock({ member, pageCalls }: Props) {
  const [open, setOpen] = useState(() => storedFlag(openKey));
  const [includeReads, setIncludeReads] = useState(() => storedFlag(readsKey));
  const [trail, setTrail] = useState<Trail | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const { problem, run } = useCall();
  const dock = useRef<HTMLElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const seenCalls = useRef(pageCalls);
  const olderInFlight = useRef(false);
  // An answer asked under the other filter belongs to a trail that is gone.
  const readsShown = useRef(includeReads);
  readsShown.current = includeReads;

  const changeOpen = useCallback((next: boolean) => {
    // Closing unmounts the entries; focus inside them would otherwise fall to the page body.
    if (!next && dock.current?.contains(globalThis.document.activeElement) === true) {
      toggle.current?.focus();
    }
    setOpen(next);
  }, []);

  useEffect(() => {
    const element = dock.current;
    if (element === null) return undefined;
    // The spacer is as tall as the dock, open or closed, so the page can scroll its last line clear of it.
    const watch = new ResizeObserver(() =>
      element.parentElement?.style.setProperty("--dock-height", `${element.offsetHeight}px`),
    );
    watch.observe(element);
    return () => watch.disconnect();
  }, []);

  useEffect(() => storeFlag(openKey, open), [open]);
  useEffect(() => storeFlag(readsKey, includeReads), [includeReads]);

  useEffect(() => {
    if (member === null) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.code !== "Backquote") return;
      event.preventDefault();
      changeOpen(!open);
    };
    globalThis.addEventListener("keydown", onKey);
    return () => globalThis.removeEventListener("keydown", onKey);
  }, [member, open, changeOpen]);

  const refresh = useCallback(() => {
    if (member === null) return;
    run(
      () => member.listMyActivity({ includeActivityReads: includeReads }),
      (page) => {
        if (readsShown.current === includeReads) {
          setTrail((current) => withNewest(current, page));
        }
      },
    );
  }, [member, run, includeReads]);

  const loadOlder = () => {
    const asked = trail?.next ?? null;
    // One older page at a time: a second click waits for the first answer.
    if (member === null || asked === null || olderInFlight.current) return;
    olderInFlight.current = true;
    setLoadingOlder(true);
    run(
      () =>
        member.listMyActivity({ ...asked, includeActivityReads: includeReads }).finally(() => {
          olderInFlight.current = false;
          setLoadingOlder(false);
        }),
      (page) => {
        if (readsShown.current === includeReads) {
          setTrail((current) => (current === null ? current : withOlder(current, asked, page)));
        }
      },
    );
  };

  const changeIncludeReads = () => {
    setTrail(null);
    setIncludeReads((current) => !current);
  };

  useEffect(refresh, [refresh]);

  useEffect(() => {
    if (pageCalls === seenCalls.current) return undefined;
    seenCalls.current = pageCalls;
    // The row is stored before the answer leaves the server, so one frame later is enough; a burst asks once.
    const frame = globalThis.requestAnimationFrame(refresh);
    return () => globalThis.cancelAnimationFrame(frame);
  }, [pageCalls, refresh]);

  const items = trail?.items ?? [];
  const newest = items[0];

  return (
    <>
      <div aria-hidden="true" className="h-(--dock-height,3rem)" />
      <Collapsible open={member !== null && open} onOpenChange={changeOpen} asChild>
        <section
          ref={dock}
          aria-label="Your audit trail"
          className="dark fixed inset-x-0 bottom-0 z-40 border-t bg-background text-foreground"
        >
          {member === null ? (
            <SignedOutBar />
          ) : (
            <>
              <div className="flex h-12 items-center gap-1 px-2">
                <CollapsibleTrigger asChild>
                  <Button
                    ref={toggle}
                    variant="ghost"
                    className="min-w-0 flex-1 shrink justify-start"
                  >
                    <TerminalIcon />
                    <span>Your audit trail</span>
                    <span className="sr-only min-w-0 font-normal text-muted-foreground sm:not-sr-only sm:truncate">
                      What the server's audit (@house-rules/call-audit) recorded for you: every
                      call, kept across reloads.
                    </span>
                    <span className="ml-auto font-normal text-muted-foreground">
                      {items.length}
                      {trail !== null && trail.next !== null ? "+" : ""}{" "}
                      {items.length === 1 ? "call" : "calls"}
                    </span>
                    <span
                      key={newest === undefined ? "none" : keyOf(newest)}
                      aria-hidden="true"
                      className={
                        newest === undefined
                          ? "size-2 rounded-full bg-muted-foreground"
                          : "size-2 rounded-full bg-primary duration-700 motion-safe:animate-in motion-safe:zoom-in-0"
                      }
                    />
                  </Button>
                </CollapsibleTrigger>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Refresh the audit trail"
                  onClick={refresh}
                >
                  <RefreshCwIcon />
                </Button>
                <CollapsibleTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={open ? "Close the audit trail" : "Open the audit trail"}
                  >
                    <ChevronUpIcon className={open ? "rotate-180" : ""} />
                  </Button>
                </CollapsibleTrigger>
              </div>
              <CollapsibleContent>
                <p className="flex items-center gap-2 border-t px-3 py-2 text-xs text-muted-foreground">
                  <InfoIcon className="size-3 shrink-0" />
                  <span>
                    What is this? A demo window onto the framework: the server keeps these rows, not
                    this page. Sign-up and sign-in run before you are anyone, so the audit keeps
                    them with no actor and they never show here. Each time this dock reads the
                    trail, that read is kept too; it stays hidden unless you include it. Ctrl+`
                    opens and closes it.
                  </span>
                </p>
                <div className="flex items-center border-t px-2 py-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-pressed={includeReads}
                    onClick={changeIncludeReads}
                  >
                    {includeReads ? <SquareCheckIcon /> : <SquareIcon />}
                    Include audit reads
                  </Button>
                </div>
                <div
                  role="region"
                  aria-label="Audit trail entries"
                  tabIndex={0}
                  className="h-[26svh] overflow-y-auto sm:h-[40svh] border-t font-mono"
                >
                  {problem !== null && (
                    <div className="p-3">
                      <ProblemAlert problem={problem} />
                    </div>
                  )}
                  {trail !== null && items.length === 0 && (
                    <p className="p-4 text-xs text-muted-foreground">
                      Nothing kept for you yet. Book a stay or open a booking: each call shows up
                      here, newest first.
                    </p>
                  )}
                  {items.length > 0 && (
                    <ul>
                      {items.map((entry, index) => (
                        // Two rows can hold the same fields, so the place keeps each key unique.
                        <EntryRow key={`${index}:${keyOf(entry)}`} entry={entry} />
                      ))}
                    </ul>
                  )}
                  {trail !== null && items.length > 0 && (
                    <TrailEnd trail={trail} loading={loadingOlder} onOlder={loadOlder} />
                  )}
                </div>
              </CollapsibleContent>
            </>
          )}
        </section>
      </Collapsible>
    </>
  );
}
