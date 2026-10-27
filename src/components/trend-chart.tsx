"use client";

import { areaY, barY, defineChart, group, lineY, type ChartCurve } from "@tanstack/charts";
import { decorative } from "@tanstack/charts/mark/decorative";
import { Chart } from "@tanstack/charts/react";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { useMemo } from "react";

import {
  areaBaseline,
  formatClock,
  timeTicks,
  type ChartType,
  type PlotRow,
  type SampleKind,
} from "@/lib/chart-data";

export type PlottedSeries = {
  label: string;
  color: string;
  kind: SampleKind;
  categories: readonly string[];
  rows: PlotRow[];
};

const stepAfter: ChartCurve = {
  line(points) {
    const first = points[0];
    if (!first) return "";
    let path = `M${first[0]},${first[1]}`;
    for (let index = 1; index < points.length; index += 1) {
      const point = points[index];
      if (!point) continue;
      path += `H${point[0]}V${point[1]}`;
    }
    return path;
  },
  area(top, bottom) {
    const first = top[0];
    if (!first) return "";
    let path = `M${first[0]},${first[1]}`;
    for (let index = 1; index < top.length; index += 1) {
      const point = top[index];
      if (!point) continue;
      path += `H${point[0]}V${point[1]}`;
    }
    const reversed = [...bottom].reverse();
    const join = reversed[0];
    if (!join) return `${path}Z`;
    path += `L${join[0]},${join[1]}`;
    for (let index = 1; index < reversed.length; index += 1) {
      const point = reversed[index];
      if (!point) continue;
      path += `H${point[0]}V${point[1]}`;
    }
    return `${path}Z`;
  },
};

export function TrendChart({
  type,
  series,
  start,
  end,
  ariaLabel,
}: {
  type: ChartType;
  series: readonly PlottedSeries[];
  start: number;
  end: number;
  ariaLabel: string;
}) {
  const definition = useMemo(
    () => buildDefinition(type, series, start, end),
    [type, series, start, end],
  );

  return (
    <Chart
      definition={definition}
      height={220}
      initialWidth={720}
      className="text-foreground"
      ariaLabel={ariaLabel}
    />
  );
}

function buildDefinition(
  type: ChartType,
  series: readonly PlottedSeries[],
  start: number,
  end: number,
) {
  const x = {
    scale: scaleLinear().domain([start, end]),
    grid: true,
    axis: {
      ticks: {
        values: timeTicks(start, end),
        format: (value: number) => formatClock(value),
      },
    },
  };

  if (type === "bar") {
    const rows = series.flatMap((item) => item.rows);
    return defineChart({
      marks: [
        barY(rows, {
          id: "bars",
          x: "t",
          y: "y",
          z: "series",
          color: "series",
          key: "id",
          layout: group({ padding: 0.2 }),
          maxThickness: 16,
        }),
      ],
      scales: {
        x,
        y: {
          scale: scaleLinear,
          nice: true,
          grid: true,
        },
      },
      color: {
        domain: series.map((item) => item.label),
        range: series.map((item) => item.color),
      },
      theme: { background: "transparent" },
    });
  }

  const dual = series.length === 2 && series.some((item) => item.kind === "number");
  const marks = series.flatMap((item, index) => {
    const yScale = dual ? (index === 0 ? "y" : "y2") : "y";
    if (type === "area") {
      return [
        decorative(
          areaY(item.rows, {
            id: `series-${index}-area`,
            x: "t",
            y: "y",
            y1: areaBaseline(item.rows),
            yScale,
            key: "id",
            fill: item.color,
            fillOpacity: 0.22,
          }),
        ),
        lineY(item.rows, {
          id: `series-${index}-line`,
          x: "t",
          y: "y",
          yScale,
          key: "id",
          stroke: item.color,
          strokeWidth: 2,
        }),
      ];
    }
    return [
      lineY(item.rows, {
        id: `series-${index}`,
        x: "t",
        y: "y",
        yScale,
        key: "id",
        stroke: item.color,
        strokeWidth: 2,
        lineCap: type === "step" ? "butt" : "round",
        lineJoin: type === "step" ? "miter" : "round",
        curve: type === "step" ? stepAfter : undefined,
      }),
    ];
  });

  return defineChart({
    marks,
    scales: {
      x,
      y: yAxis(series[0], true, type),
      ...(dual && series[1]
        ? {
            y2: {
              ...yAxis(series[1], false, type),
              channel: "y" as const,
              side: "right" as const,
            },
          }
        : {}),
    },
    theme: { background: "transparent" },
  });
}

function integerStepAxis(rows: readonly PlotRow[], grid: boolean) {
  const values = rows.map((row) => row.y).filter((value) => Number.isFinite(value));
  if (values.length === 0 || values.some((value) => !Number.isInteger(value))) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const low = min === max ? min - 1 : min;
  const high = min === max ? max + 1 : max;
  if (high - low > 12) return null;
  const ticks: number[] = [];
  for (let value = low; value <= high; value += 1) ticks.push(value);
  return {
    scale: scaleLinear().domain([low, high]),
    grid,
    axis: {
      ticks: {
        values: ticks,
        format: (value: number) => String(value),
      },
    },
  };
}

function yAxis(series: PlottedSeries | undefined, grid: boolean, type: ChartType) {
  if (!series || series.kind === "number") {
    const integerStep = type === "step" ? integerStepAxis(series?.rows ?? [], grid) : null;
    if (integerStep) return integerStep;
    return {
      scale: scaleLinear,
      nice: true,
      grid,
      axis: { ticks: { count: 4 } },
    };
  }
  if (series.kind === "boolean") {
    return {
      scale: scaleLinear().domain([-0.25, 1.25]),
      grid,
      axis: {
        ticks: {
          values: [0, 1],
          format: (value: number) => (value >= 0.5 ? "true" : "false"),
        },
      },
    };
  }
  const labels = series.categories;
  const max = Math.max(labels.length - 1, 0);
  const pad = labels.length <= 1 ? 1 : 0.35;
  return {
    scale: scaleLinear().domain([-pad, max + pad]),
    grid,
    axis: {
      ticks: {
        values: labels.map((_, index) => index),
        format: (value: number) => labels[value] ?? String(value),
      },
    },
  };
}
