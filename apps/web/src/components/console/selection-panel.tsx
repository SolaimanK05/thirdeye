import { Crosshair, LocateFixed, Star, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "./cx";
import { Disclosure } from "./disclosure";
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

export function SelectionDetails({
  selection,
  onAction,
}: {
  selection: Selection;
  onAction?: (action: SelectionAction) => void;
}) {
  return (
    <>
      <Disclosure
        title={`[ ${selection.kind} ]`}
        meta={
          selection.starred && (
            <span className="text-amber">
              <Star size={13} fill="currentColor" aria-hidden="true" />
              <span className="sr-only">Starred</span>
            </span>
          )
        }
        className="border-line border-b pb-3"
        summaryClassName="px-4 pt-1 lg:in-data-[rail=right]:pl-11"
      >
        <div className="flex flex-col gap-2 px-4">
          <h3 className="hidden text-balance font-display text-accent text-display text-shadow-glow lg:block">
            {selection.name}
          </h3>
          <p className="text-ink-2 text-secondary">{selection.subline}</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {selection.actions.map((action) => {
              const { label, icon, key } = ACTIONS[action];
              return (
                <button
                  key={action}
                  type="button"
                  onClick={() => onAction?.(action)}
                  aria-label={label(selection.starred)}
                  aria-keyshortcuts={key}
                  title={label(selection.starred)}
                  aria-pressed={
                    action === "follow"
                      ? selection.following === true
                      : undefined
                  }
                  className={cx(
                    "flex min-h-9 min-w-9 items-center justify-center gap-1.5 border border-line-2 px-2 transition-colors duration-120 ease-out hover-fine:text-accent",
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
                  {key && (
                    <span
                      aria-hidden="true"
                      className="text-ink-3 text-label tracking-normal"
                    >
                      {key}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </Disclosure>

      {selection.sections.map((section) => (
        <Disclosure
          key={section.label}
          title={`[ ${section.label} ]`}
          className="border-line border-b pb-2.5"
          summaryClassName="px-4"
        >
          <dl className="grid grid-cols-[76px_minmax(0,1fr)_auto] items-baseline gap-x-2.5 gap-y-1.25 px-4">
            {section.rows.map((row) => (
              <div key={row.key} className="contents">
                <dt className="text-ink-3 text-label tracking-[0.06em]">
                  {row.key}
                </dt>
                <dd className="min-w-0 wrap-anywhere text-ink tabular-nums">
                  {row.value}
                </dd>
                <dd>
                  <ConfidenceBadge tag={row.confidence} />
                </dd>
              </div>
            ))}
          </dl>
        </Disclosure>
      ))}

      {selection.chart && (
        <Disclosure
          title={`[ ${selection.chart.label} ]`}
          className="border-line border-b pb-2.5"
          summaryClassName="px-4"
        >
          <SpeedChart chart={selection.chart} />
        </Disclosure>
      )}

      <Disclosure
        title="[ PROVENANCE ]"
        className="pb-4.5"
        summaryClassName="px-4"
      >
        <div className="px-4">
          <dl className="mb-3 grid grid-cols-[76px_minmax(0,1fr)] gap-x-2.5 gap-y-1.25">
            <ProvenanceRow term="SOURCE" value={selection.provenance.source} />
            <ProvenanceRow
              term="RETRIEVED"
              value={selection.provenance.retrieved}
            />
            <ProvenanceRow
              term="RELIABILITY"
              value={selection.provenance.reliability}
            />
            <ProvenanceRow
              term="LICENCE"
              value={selection.provenance.licence}
            />
          </dl>
          <h3 className="mb-1.5 flex items-center gap-1.5 text-amber text-label">
            <TriangleAlert size={13} aria-hidden="true" />
            LIMITS
          </h3>
          <ul className="flex list-disc flex-col gap-1.5 pl-6.5 text-ink-2 text-secondary marker:text-amber">
            {selection.limitations.map((limitation) => (
              <li key={limitation}>{limitation}</li>
            ))}
          </ul>
          <ul
            aria-label="Confidence tags"
            className="mt-3.5 flex flex-wrap gap-x-3 gap-y-1 text-ink-3 text-micro tracking-normal"
          >
            {LEGEND.map(({ tag, word }) => (
              <li key={tag}>
                {tag} {word}
              </li>
            ))}
          </ul>
        </div>
      </Disclosure>
    </>
  );
}

function ProvenanceRow({ term, value }: { term: string; value: string }) {
  return (
    <div className="contents">
      <dt className="text-ink-3 text-label tracking-normal">{term}</dt>
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
        "border px-1 text-micro leading-4 tracking-[0.06em] no-underline",
        className,
      )}
    >
      {tag}
    </abbr>
  );
}
