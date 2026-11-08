import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { chartGeometry, describeChart, spanLabel } from "./chart";
import { SpeedChart } from "./speed-chart";
import type { SelectionChart } from "./types";

const MINUTE = 60_000;

const CHART: SelectionChart = {
  label: "SPEED",
  unit: "kn",
  points: [
    { t: 0, v: 0 },
    { t: 10 * MINUTE, v: 5 },
    { t: 20 * MINUTE, v: 10 },
  ],
};

describe("chart geometry", () => {
  test("needs two readings over some time", () => {
    expect(chartGeometry([])).toBeNull();
    expect(chartGeometry([{ t: 0, v: 1 }])).toBeNull();
    expect(
      chartGeometry([
        { t: 5, v: 1 },
        { t: 5, v: 2 },
      ]),
    ).toBeNull();
    expect(
      chartGeometry([
        { t: 0, v: Number.NaN },
        { t: 1, v: 1 },
      ]),
    ).toBeNull();
  });

  test("plots time left to right and speed upward from zero", () => {
    const geometry = chartGeometry(CHART.points, 104, 54);
    expect(geometry?.path).toBe("M2.0 52.0 L52.0 27.0 L102.0 2.0");
    expect(geometry?.end).toEqual({ x: 102, y: 2 });
    expect(geometry?.max).toBe(10);
    expect(geometry?.spanMs).toBe(20 * MINUTE);
  });

  test("keeps a flat series on the baseline", () => {
    const geometry = chartGeometry(
      [
        { t: 0, v: 0 },
        { t: MINUTE, v: 0 },
      ],
      104,
      54,
    );
    expect(geometry?.max).toBe(1);
    expect(geometry?.path).toBe("M2.0 52.0 L102.0 52.0");
  });

  test("labels spans", () => {
    expect(spanLabel(0)).toBe("1 min");
    expect(spanLabel(40 * MINUTE)).toBe("40 min");
    expect(spanLabel(60 * MINUTE)).toBe("1 h");
    expect(spanLabel(125 * MINUTE)).toBe("2 h 5 min");
  });

  test("describes the chart in words", () => {
    const geometry = chartGeometry(CHART.points);
    expect(geometry).not.toBeNull();
    if (geometry === null) return;
    expect(describeChart(CHART, geometry)).toBe(
      "SPEED over the last 20 min, latest 10.0 kn, peak 10.0 kn",
    );
  });
});

describe("speed chart", () => {
  test("draws an image with a text description", () => {
    const html = renderToStaticMarkup(<SpeedChart chart={CHART} />);
    expect(html).toContain('role="img"');
    expect(html).toContain("SPEED over the last 20 min");
    expect(html).toContain("peak 10.0 kn");
    expect(html).not.toContain("·");
  });

  test("says so when there is too little to draw", () => {
    const html = renderToStaticMarkup(
      <SpeedChart chart={{ ...CHART, points: [{ t: 0, v: 1 }] }} />,
    );
    expect(html).not.toContain("<svg");
    expect(html).toContain("Not enough fixes yet");
  });
});
