import {
  CHART_HEIGHT,
  CHART_WIDTH,
  chartGeometry,
  describeChart,
  spanLabel,
} from "./chart";
import type { SelectionChart } from "./types";

export function SpeedChart({ chart }: { chart: SelectionChart }) {
  const geometry = chartGeometry(chart.points);
  if (geometry === null) {
    return (
      <p className="px-4 text-ink-2 text-secondary">
        Not enough fixes yet to draw a {chart.label.toLowerCase()} history.
      </p>
    );
  }
  return (
    <div className="px-4">
      <svg
        role="img"
        aria-label={describeChart(chart, geometry)}
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        className="h-14 w-full text-accent"
        preserveAspectRatio="none"
      >
        <line
          x1="0"
          x2={CHART_WIDTH}
          y1={CHART_HEIGHT - 2}
          y2={CHART_HEIGHT - 2}
          className="stroke-line-2"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d={geometry.path}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        <circle
          cx={geometry.end.x}
          cy={geometry.end.y}
          r="2.5"
          fill="currentColor"
        />
      </svg>
      <p className="mt-1 flex justify-between text-ink-3 text-micro tracking-normal tabular-nums">
        <span>{spanLabel(geometry.spanMs)} ago</span>
        <span>
          peak {geometry.max.toFixed(1)} {chart.unit}
        </span>
        <span>now</span>
      </p>
    </div>
  );
}
