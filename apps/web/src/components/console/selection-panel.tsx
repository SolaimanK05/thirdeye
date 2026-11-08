import { Tabs } from "@base-ui/react/tabs";
import { Crosshair, LocateFixed, Star, TriangleAlert, X } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "./cx";
import { splitKeyFacts } from "./key-facts";
import { SpeedChart } from "./speed-chart";
import { CONFIDENCE } from "./status";
import type { ConfidenceTag, Selection, SelectionAction } from "./types";

const ACTIONS: Record<
  SelectionAction,
  { label: (starred: boolean) => string; icon: ReactNode; key?: string }
> = {
  star: {
    label: (starred) => (starred ? "Unstar" : "Star"),
    icon: <Star size={15} aria-hidden="true" />,
    key: "s",
  },
  follow: {
    label: () => "Follow",
    icon: <Crosshair size={15} aria-hidden="true" />,
    key: "f",
  },
  center: {
    label: () => "Center on globe",
    icon: <LocateFixed size={15} aria-hidden="true" />,
  },
};

const LEGEND: { tag: ConfidenceTag; word: string }[] = [
  { tag: "OBS", word: "observed" },
  { tag: "REP", word: "reported" },
  { tag: "DER", word: "derived" },
  { tag: "INF", word: "inferred" },
];

export function SelectionMessage({
  children,
  desktopOnly = false,
}: {
  children: ReactNode;
  desktopOnly?: boolean;
}) {
  return (
    <div
      className={cx(
        "flex-col gap-2 px-4 py-3.5 lg:flex lg:pl-11",
        desktopOnly ? "hidden" : "flex",
      )}
    >
      <h2 className="hidden text-ink-3 text-label lg:block">[ SELECTION ]</h2>
      <p role="status" className="text-ink-2">
        {children}
      </p>
    </div>
  );
}

const TAB =
  "min-h-11 flex-1 border-transparent border-b-2 px-2 text-center text-secondary text-ink-3 tracking-[0.12em] transition-colors duration-120 ease-out hover-fine:text-ink-2 data-active:border-accent data-active:text-accent lg:min-h-10";

/** The three buttons beside the type label: star, follow, centre. */
function ActionButtons({
  selection,
  onAction,
  onClose,
}: {
  selection: Selection;
  onAction?: (action: SelectionAction) => void;
  onClose?: () => void;
}) {
  return (
    <span className="flex gap-1.5">
      {selection.actions.map((action) => {
        const { label, icon, key } = ACTIONS[action];
        return (
          <button
            key={action}
            type="button"
            onClick={() => onAction?.(action)}
            aria-label={label(selection.starred)}
            aria-keyshortcuts={key}
            title={
              key
                ? `${label(selection.starred)} (${key})`
                : label(selection.starred)
            }
            aria-pressed={
              action === "follow" ? selection.following === true : undefined
            }
            className={cx(
              "flex size-9 items-center justify-center border border-line-2 transition-colors duration-120 ease-out hover-fine:text-accent max-lg:size-11",
              action === "star" && selection.starred
                ? "text-amber"
                : action === "follow" && selection.following
                  ? "border-accent text-accent"
                  : "text-ink",
            )}
          >
            {action === "star" && selection.starred ? (
              <Star size={15} fill="currentColor" aria-hidden="true" />
            ) : (
              icon
            )}
          </button>
        );
      })}
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          aria-keyshortcuts="Escape"
          title="Close (Esc)"
          className="flex size-9 items-center justify-center border border-line-2 text-ink transition-colors duration-120 ease-out hover-fine:text-accent max-lg:size-11"
        >
          <X size={15} aria-hidden="true" />
        </button>
      )}
    </span>
  );
}

function KeyFacts({ facts }: { facts: Selection["sections"][number]["rows"] }) {
  return (
    <dl className="grid grid-cols-3 gap-x-3 gap-y-2">
      {facts.map((fact) => (
        <div key={fact.key} className="flex min-w-0 flex-col gap-1">
          <dt className="text-ink-3 text-secondary">
            {sentenceCase(fact.key)}
          </dt>
          <dd
            className={cx(
              "wrap-anywhere text-accent tabular-nums",
              fact.value.length <= 9 ? "text-readout" : "text-body",
            )}
          >
            {fact.value}
          </dd>
          <dd>
            <ConfidenceBadge tag={fact.confidence} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function RowList({ rows }: { rows: Selection["sections"][number]["rows"] }) {
  return (
    <dl className="grid grid-cols-[96px_minmax(0,1fr)_auto] items-baseline gap-x-2.5 gap-y-2.5 text-secondary">
      {rows.map((row) => (
        <div key={row.key} className="contents">
          <dt className="text-ink-3">{sentenceCase(row.key)}</dt>
          <dd className="min-w-0 wrap-anywhere text-ink tabular-nums">
            {row.value}
          </dd>
          <dd>
            <ConfidenceBadge tag={row.confidence} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

const sentenceCase = (text: string) =>
  text.charAt(0) + text.slice(1).toLowerCase();

export function SelectionDetails({
  selection,
  onAction,
  onClose,
}: {
  selection: Selection;
  onAction?: (action: SelectionAction) => void;
  onClose?: () => void;
}) {
  const { facts, sections } = splitKeyFacts(selection);
  const [first, ...rest] = sections;
  const note = selection.limitations[0];
  const details = [...rest];

  return (
    <Tabs.Root defaultValue="overview" className="flex flex-col">
      <header className="flex flex-col gap-2 px-4 pt-3 pb-3.5 lg:in-data-[rail=right]:pl-11">
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-accent text-label tracking-[0.12em]">
            [ {selection.kind.toUpperCase()} ]
            {selection.starred && (
              <span className="text-amber">
                <Star size={13} fill="currentColor" aria-hidden="true" />
                <span className="sr-only">Starred</span>
              </span>
            )}
          </h2>
          <ActionButtons
            selection={selection}
            onAction={onAction}
            onClose={onClose}
          />
        </div>
        <p className="hidden text-balance font-display text-accent text-display text-shadow-glow lg:block">
          {selection.name}
        </p>
        <p className="text-ink-2 text-secondary">{selection.subline}</p>
      </header>

      <Tabs.List
        aria-label="Selection details"
        className="flex border-line border-y"
      >
        <Tabs.Tab value="overview" className={TAB}>
          OVERVIEW
        </Tabs.Tab>
        {details.length > 0 && (
          <Tabs.Tab value="details" className={TAB}>
            DETAILS
          </Tabs.Tab>
        )}
        <Tabs.Tab value="source" className={TAB}>
          SOURCE
        </Tabs.Tab>
      </Tabs.List>

      <Tabs.Panel
        keepMounted
        value="overview"
        className="flex flex-col gap-4 px-4 py-4"
      >
        {note && (
          <p
            role="note"
            className="flex gap-2.5 border border-amber px-3 py-2.5 text-amber text-secondary"
          >
            <TriangleAlert
              size={14}
              aria-hidden="true"
              className="mt-0.5 shrink-0"
            />
            {note}
          </p>
        )}
        {facts.length > 0 && <KeyFacts facts={facts} />}
        {first && <RowList rows={first.rows} />}
        {selection.chart && <SpeedChart chart={selection.chart} />}
      </Tabs.Panel>

      {details.length > 0 && (
        <Tabs.Panel
          keepMounted
          value="details"
          className="flex flex-col gap-5 px-4 py-4"
        >
          {details.map((section) => (
            <section key={section.label} className="flex flex-col gap-2.5">
              <h3 className="text-ink-3 text-label tracking-[0.12em]">
                {section.label}
              </h3>
              <RowList rows={section.rows} />
            </section>
          ))}
        </Tabs.Panel>
      )}

      <Tabs.Panel
        keepMounted
        value="source"
        className="flex flex-col gap-4 px-4 py-4"
      >
        <dl className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-2.5 gap-y-2.5 text-secondary">
          <ProvenanceRow term="Source" value={selection.provenance.source} />
          <ProvenanceRow
            term="Retrieved"
            value={selection.provenance.retrieved}
          />
          <ProvenanceRow
            term="Reliability"
            value={selection.provenance.reliability}
          />
          <ProvenanceRow term="Licence" value={selection.provenance.licence} />
        </dl>
        <section className="flex flex-col gap-1.5">
          <h3 className="flex items-center gap-1.5 text-amber text-label tracking-[0.12em]">
            <TriangleAlert size={13} aria-hidden="true" />
            LIMITS
          </h3>
          <ul className="flex list-disc flex-col gap-1.5 pl-6.5 text-ink-2 text-secondary marker:text-amber">
            {selection.limitations.map((limitation) => (
              <li key={limitation}>{limitation}</li>
            ))}
          </ul>
        </section>
        <ul
          aria-label="Confidence tags"
          className="flex flex-wrap gap-x-3 gap-y-1 text-ink-3 text-secondary"
        >
          {LEGEND.map(({ tag, word }) => (
            <li key={tag}>
              {tag} {word}
            </li>
          ))}
        </ul>
      </Tabs.Panel>
    </Tabs.Root>
  );
}

function ProvenanceRow({ term, value }: { term: string; value: string }) {
  return (
    <div className="contents">
      <dt className="text-ink-3">{term}</dt>
      <dd className="min-w-0 text-ink tabular-nums">{value}</dd>
    </div>
  );
}

function ConfidenceBadge({ tag }: { tag: ConfidenceTag }) {
  const { meaning, className } = CONFIDENCE[tag];
  return (
    <abbr
      title={meaning}
      className={cx(
        "border px-1 text-secondary leading-4 tracking-[0.06em] no-underline",
        className,
      )}
    >
      {tag}
    </abbr>
  );
}
