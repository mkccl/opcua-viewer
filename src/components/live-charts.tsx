"use client";

import { Download, Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { TrendChart, type PlottedSeries } from "@/components/trend-chart";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CHART_TYPES,
  SERIES_COLORS,
  TIME_WINDOWS,
  barSliceMs,
  chartCsv,
  classifyValue,
  ingestWatch,
  plotRows,
  rangesFlatten,
  samplesForExport,
  samplesInWindow,
  selectionState,
  seriesLabel,
  windowStart,
  type ChartType,
  type SeriesHistory,
  type WindowMinutes,
} from "@/lib/chart-data";
import type { WatchItem } from "@/lib/types";
import { cn } from "@/lib/utils";

type ChartConfig = {
  id: string;
  type: ChartType;
  windowMinutes: WindowMinutes;
  nodeIds: string[];
};

export function LiveCharts({ items, live }: { items: WatchItem[]; live: boolean }) {
  const [charts, setCharts] = useState<ChartConfig[]>([]);
  const [tick, setTick] = useState(() => Date.now());
  const [snapshot, setSnapshot] = useState(() => {
    const receivedAt = Date.now();
    return {
      items,
      receivedAt,
      history: ingestWatch(new Map(), items, receivedAt),
    };
  });
  const endRef = useRef<HTMLDivElement>(null);
  const chartCount = useRef(0);

  if (snapshot.items !== items) {
    setSnapshot((current) => {
      if (current.items === items) return current;
      const history = ingestWatch(current.history, items, current.receivedAt);
      let receivedAt = current.receivedAt;
      for (const series of history.values()) {
        const latest = series.samples.at(-1)?.t ?? 0;
        if (latest > receivedAt) receivedAt = latest;
      }
      return { items, receivedAt, history };
    });
  }

  const history = snapshot.history;
  const now = Math.max(tick, snapshot.receivedAt);

  useEffect(() => {
    const timer = window.setInterval(() => setTick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (charts.length > chartCount.current) {
      endRef.current?.scrollIntoView({ block: "nearest" });
    }
    chartCount.current = charts.length;
  }, [charts.length]);

  function addChart() {
    setCharts((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        type: "line",
        windowMinutes: 1,
        nodeIds: [],
      },
    ]);
  }

  function updateChart(id: string, patch: Partial<Omit<ChartConfig, "id">>) {
    setCharts((current) =>
      current.map((chart) => (chart.id === id ? { ...chart, ...patch } : chart)),
    );
  }

  function toggleNode(id: string, nodeId: string) {
    setCharts((current) =>
      current.map((chart) => {
        if (chart.id !== id) return chart;
        const selected = chart.nodeIds.includes(nodeId);
        return {
          ...chart,
          nodeIds: selected
            ? chart.nodeIds.filter((entry) => entry !== nodeId)
            : [...chart.nodeIds, nodeId],
        };
      }),
    );
  }

  return (
    <section id="charts" className="flex shrink-0 flex-col border-t">
      <div className="flex h-11 shrink-0 items-center justify-between gap-3 px-4">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium">Charts</h2>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className={cn("size-1.5 rounded-full", live ? "bg-emerald-500" : "bg-muted-foreground")} />
            {live ? "Live" : "Connecting"}
          </span>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={addChart}>
          <Plus />
          Add chart
        </Button>
      </div>
      {charts.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-muted-foreground">
          Add a chart, then choose watched variables. Numbers can be a line, area, or bar.
          Booleans and text use a step line.
        </p>
      ) : (
        <div className="flex flex-col gap-4 px-4 pb-4">
          {charts.map((chart, index) => (
            <ChartCard
              key={chart.id}
              chart={chart}
              index={index}
              items={items}
              history={history}
              now={now}
              onType={(type) => updateChart(chart.id, { type })}
              onWindow={(windowMinutes) => updateChart(chart.id, { windowMinutes })}
              onToggle={(nodeId) => toggleNode(chart.id, nodeId)}
              onRemove={() => setCharts((current) => current.filter((entry) => entry.id !== chart.id))}
            />
          ))}
          <div ref={endRef} />
        </div>
      )}
    </section>
  );
}

function ChartCard({
  chart,
  index,
  items,
  history,
  now,
  onType,
  onWindow,
  onToggle,
  onRemove,
}: {
  chart: ChartConfig;
  index: number;
  items: WatchItem[];
  history: ReadonlyMap<string, SeriesHistory>;
  now: number;
  onType: (type: ChartType) => void;
  onWindow: (minutes: WindowMinutes) => void;
  onToggle: (nodeId: string) => void;
  onRemove: () => void;
}) {
  const start = windowStart(now, chart.windowMinutes);
  const chosen = chart.nodeIds
    .map((nodeId) => history.get(nodeId))
    .filter((series): series is SeriesHistory => series !== undefined);
  const selected = chosen.filter(
    (series) => selectionState(series.kind, chart.type, null).enabled,
  );
  const plotted = selected.map((series, seriesIndex) => {
    const label = seriesLabel(series, selected);
    const shape = chart.type === "bar" ? "bar" : "path";
    return {
      series,
      label,
      color: SERIES_COLORS[seriesIndex % SERIES_COLORS.length],
      rows: plotRows(series, label, start, now, shape),
    };
  });
  const visible = plotted.filter((item) => item.rows.length > 0);
  const sampleCount = selected.reduce(
    (total, series) => total + samplesInWindow(series, start, now).length,
    0,
  );
  const exportCount = selected.reduce(
    (total, series) => total + samplesForExport(series, start, now).length,
    0,
  );
  const flattened =
    chart.type !== "bar" && selected.length > 2 && rangesFlatten(selected, start, now);
  const ariaLabel = `${chartLabel(chart.type)} of ${
    visible.map((item) => item.label).join(", ") || "no variables"
  }`;

  function exportCsv() {
    const csv = chartCsv(selected, start, now);
    const slug = plotted
      .map((item) => item.label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""))
      .filter(Boolean)
      .join("-");
    downloadText(`${slug || "chart"}-${chart.windowMinutes}min.csv`, csv);
  }

  return (
    <div className="min-w-0 rounded-lg ring-1 ring-foreground/10" data-chart-index={index}>
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <Select value={chart.type} onValueChange={(value) => onType(value as ChartType)}>
          <SelectTrigger aria-label={`Chart ${index + 1} type`} className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CHART_TYPES.map((type) => (
              <SelectItem key={type.id} value={type.id}>
                {type.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={String(chart.windowMinutes)}
          onValueChange={(value) => onWindow(Number(value) as WindowMinutes)}
        >
          <SelectTrigger aria-label={`Chart ${index + 1} time window`} className="w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TIME_WINDOWS.map((window) => (
              <SelectItem key={window.minutes} value={String(window.minutes)}>
                {window.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground tabular-nums">
          {sampleCount > 0 ? `${sampleCount} samples` : visible.length > 0 ? "Held value" : "0 samples"}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={exportCount === 0}
            onClick={exportCsv}
          >
            <Download />
            CSV
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={`Remove chart ${index + 1}`}
            onClick={onRemove}
          >
            <X />
          </Button>
        </div>
      </div>
      <div className="flex flex-col gap-3 p-3">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Watch a variable to chart it.</p>
        ) : (
          <fieldset className="flex flex-wrap gap-x-4 gap-y-2">
            <legend className="sr-only">Variables for chart {index + 1}</legend>
            {items.map((item) => {
              const option = optionFor(item, history.get(item.nodeId), chart.type);
              const checked = chart.nodeIds.includes(item.nodeId);
              return (
                <label
                  key={item.nodeId}
                  className={cn(
                    "flex items-center gap-2 text-sm",
                    option.enabled ? "cursor-pointer" : "text-muted-foreground",
                  )}
                >
                  <input
                    type="checkbox"
                    className="size-3.5 accent-foreground"
                    checked={checked}
                    disabled={!option.enabled && !checked}
                    onChange={() => onToggle(item.nodeId)}
                  />
                  <span>{item.displayName}</span>
                  <span className="font-mono text-xs text-muted-foreground tabular-nums">
                    {item.value ?? "—"}
                  </span>
                  {option.note ? (
                    <span className="text-xs text-muted-foreground">{option.note}</span>
                  ) : null}
                </label>
              );
            })}
          </fieldset>
        )}
        {chart.nodeIds.length === 0 ? (
          <p className="text-sm text-muted-foreground">Select one or more watched variables.</p>
        ) : selected.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            None of the selected variables can be drawn on this chart. Text values use a step line.
          </p>
        ) : visible.length === 0 ? (
          <p className="text-sm text-muted-foreground">Waiting for samples.</p>
        ) : (
          <TrendChart
            type={chart.type}
            series={visible.map(toPlotted)}
            start={start}
            end={now}
            ariaLabel={ariaLabel}
          />
        )}
        {chart.type === "bar" && visible.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            Each bar is the latest sample in a {barSliceMs(start, now) / 1000}s slice. CSV export
            keeps every sample.
          </p>
        ) : null}
        {flattened ? (
          <p className="text-xs text-muted-foreground">
            These ranges differ a lot on one scale. Two variables get a left and a right axis;
            move another variable onto its own chart to see its movement.
          </p>
        ) : null}
        {visible.length > 0 ? (
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {plotted.map((item) => (
              <li key={item.series.nodeId} className="flex items-center gap-1.5">
                <span className="size-2 rounded-full" style={{ backgroundColor: item.color }} />
                <span>{item.label}</span>
                <span className="font-mono text-muted-foreground tabular-nums">
                  {item.series.samples.at(-1)?.text ?? "—"}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

function toPlotted(item: {
  series: SeriesHistory;
  label: string;
  color: string;
  rows: ReturnType<typeof plotRows>;
}): PlottedSeries {
  return {
    label: item.label,
    color: item.color,
    kind: item.series.kind,
    categories: item.series.categories,
    rows: item.rows,
  };
}

function optionFor(item: WatchItem, series: SeriesHistory | undefined, type: ChartType) {
  if (series && series.samples.length > 0) return selectionState(series.kind, type, null);
  const classified = classifyValue(item.value);
  if (!classified.ok) return selectionState(null, type, classified.reason);
  return selectionState(classified.kind, type, null);
}

function chartLabel(type: ChartType): string {
  return CHART_TYPES.find((entry) => entry.id === type)?.label ?? "Chart";
}

function downloadText(filename: string, contents: string) {
  const blob = new Blob([contents], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
