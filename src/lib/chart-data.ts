import type { WatchItem } from "@/lib/types";

export const SERIES_COLORS = [
  "#2563eb",
  "#f97316",
  "#10b981",
  "#8b5cf6",
  "#ec4899",
  "#06b6d4",
] as const;

export const CHART_TYPES = [
  { id: "line", label: "Line" },
  { id: "area", label: "Area" },
  { id: "bar", label: "Bar" },
  { id: "step", label: "Step line" },
] as const;

export const TIME_WINDOWS = [
  { minutes: 1, label: "1 min" },
  { minutes: 5, label: "5 min" },
  { minutes: 15, label: "15 min" },
] as const;

export type ChartType = (typeof CHART_TYPES)[number]["id"];
export type WindowMinutes = (typeof TIME_WINDOWS)[number]["minutes"];
export type SampleKind = "number" | "boolean" | "category";

const RETAIN_MS = 15 * 60 * 1000;
const MAX_SAMPLES = 15 * 60 * 4;
const NUMBER_TEXT = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

export type Sample = {
  t: number;
  sourceTimestamp: string | null;
  serverTimestamp: string | null;
  text: string;
  numeric: number;
};

export type SeriesHistory = {
  nodeId: string;
  displayName: string;
  kind: SampleKind;
  categories: string[];
  samples: Sample[];
};

export type PlotRow = {
  id: string;
  t: number;
  y: number;
  series: string;
};

type Classified =
  | { ok: true; kind: SampleKind; numeric: number; text: string }
  | { ok: false; reason: string };

export function classifyValue(value: string | null): Classified {
  if (value == null || value === "" || value === "null" || value === "NaN" || value === "Infinity" || value === "-Infinity") {
    return { ok: false, reason: "No value" };
  }
  if (value === "true") return { ok: true, kind: "boolean", numeric: 1, text: value };
  if (value === "false") return { ok: true, kind: "boolean", numeric: 0, text: value };
  if (NUMBER_TEXT.test(value)) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return { ok: true, kind: "number", numeric, text: value };
  }
  if (
    value.length > 80 ||
    value.includes(",") ||
    value.includes("\n") ||
    value.startsWith("{") ||
    value.startsWith("[")
  ) {
    return { ok: false, reason: "Not a single value" };
  }
  return { ok: true, kind: "category", numeric: 0, text: value };
}

export function selectionState(
  kind: SampleKind | null,
  type: ChartType,
  reason: string | null,
): { enabled: boolean; note: string | null } {
  if (!kind) return { enabled: false, note: reason ?? "No value" };
  if (kind === "category" && type !== "step") {
    return { enabled: false, note: "Text values use a step line" };
  }
  if (kind === "boolean") return { enabled: true, note: "Boolean" };
  if (kind === "category") return { enabled: true, note: "Text" };
  return { enabled: true, note: null };
}

export function ingestWatch(
  history: ReadonlyMap<string, SeriesHistory>,
  items: readonly WatchItem[],
  now: number,
): ReadonlyMap<string, SeriesHistory> {
  let next: Map<string, SeriesHistory> | null = null;
  const seen = new Set<string>();
  const ensure = () => {
    if (!next) next = new Map(history);
    return next;
  };

  for (const item of items) {
    seen.add(item.nodeId);
    const classified = classifyValue(item.value);
    const existing = (next ?? history).get(item.nodeId);

    if (!classified.ok) {
      if (existing && existing.displayName !== item.displayName) {
        ensure().set(item.nodeId, { ...existing, displayName: item.displayName });
      }
      continue;
    }

    const last = existing?.samples.at(-1);
    const unchanged =
      existing !== undefined &&
      existing.kind === classified.kind &&
      existing.displayName === item.displayName &&
      last !== undefined &&
      last.text === classified.text &&
      last.sourceTimestamp === item.sourceTimestamp &&
      last.serverTimestamp === item.serverTimestamp;
    if (unchanged) continue;

    const reset = existing === undefined || existing.kind !== classified.kind;
    const categories = reset ? [] : existing.categories.slice();
    let numeric = classified.numeric;
    if (classified.kind === "category") {
      let index = categories.indexOf(classified.text);
      if (index === -1) {
        categories.push(classified.text);
        index = categories.length - 1;
      }
      numeric = index;
    }

    const samples = reset ? [] : existing.samples.slice();
    const previous = samples.at(-1)?.t ?? Number.NEGATIVE_INFINITY;
    const t = Math.max(eventTime(item, now), previous + 1);
    samples.push({
      t,
      sourceTimestamp: item.sourceTimestamp,
      serverTimestamp: item.serverTimestamp,
      text: classified.text,
      numeric,
    });
    trimSamples(samples, Math.max(now, t));
    ensure().set(item.nodeId, {
      nodeId: item.nodeId,
      displayName: item.displayName,
      kind: classified.kind,
      categories,
      samples,
    });
  }

  for (const nodeId of [...(next ?? history).keys()]) {
    if (!seen.has(nodeId)) ensure().delete(nodeId);
  }

  return next ?? history;
}

export function seriesLabel(series: SeriesHistory, selected: readonly SeriesHistory[]): string {
  const duplicate = selected.filter((item) => item.displayName === series.displayName).length > 1;
  return duplicate ? `${series.displayName} (${series.nodeId})` : series.displayName;
}

/** Width of one bar slice. Series share these boundaries so a 1 ms timestamp skew cannot collapse the bars. */
export function barSliceMs(start: number, end: number): number {
  const span = Math.max(1000, end - start);
  return Math.max(1000, Math.round(span / 20 / 1000) * 1000);
}

export function plotRows(
  series: SeriesHistory,
  label: string,
  start: number,
  end: number,
  shape: "path" | "bar",
): PlotRow[] {
  let prior: Sample | undefined;
  const inside: Sample[] = [];
  for (const sample of series.samples) {
    if (sample.t < start) prior = sample;
    else if (sample.t <= end) inside.push(sample);
    else break;
  }

  if (shape === "bar") return barRows(series, label, inside, start, end);

  const rows: PlotRow[] = [];
  if (prior && (inside.length === 0 || inside[0].t > start)) {
    rows.push(toRow(label, prior, start, `${series.nodeId}:carry`));
  }
  for (const sample of inside) {
    rows.push(toRow(label, sample, sample.t, `${series.nodeId}:${sample.t}`));
  }
  const last = rows.at(-1);
  if (last && last.t < end) rows.push({ ...last, id: `${series.nodeId}:edge`, t: end });
  return rows;
}

export function samplesInWindow(series: SeriesHistory, start: number, end: number): Sample[] {
  return series.samples.filter((sample) => sample.t >= start && sample.t <= end);
}

/** Samples drawn from the buffer for this window, including a held value when nothing changed inside it. */
export function samplesForExport(series: SeriesHistory, start: number, end: number): Sample[] {
  const inside = samplesInWindow(series, start, end);
  if (inside.length > 0) return inside;
  let prior: Sample | undefined;
  for (const sample of series.samples) {
    if (sample.t <= end) prior = sample;
    else break;
  }
  return prior ? [prior] : [];
}

export function chartCsv(seriesList: readonly SeriesHistory[], start: number, end: number): string {
  const rows: Array<{ t: number; name: string; line: string }> = [];
  for (const series of seriesList) {
    for (const sample of samplesForExport(series, start, end)) {
      rows.push({
        t: sample.t,
        name: series.displayName,
        line: [
          new Date(sample.t).toISOString(),
          sample.sourceTimestamp ?? "",
          sample.serverTimestamp ?? "",
          series.nodeId,
          series.displayName,
          sample.text,
        ]
          .map(csvCell)
          .join(","),
      });
    }
  }
  rows.sort((left, right) => left.t - right.t || left.name.localeCompare(right.name));
  return ["receivedAt,sourceTimestamp,serverTimestamp,nodeId,name,value", ...rows.map((row) => row.line)].join("\n") + "\n";
}

export function timeTicks(start: number, end: number): number[] {
  const span = Math.max(0, end - start);
  const step = span <= 90_000 ? 15_000 : span <= 6 * 60_000 ? 60_000 : 3 * 60_000;
  const ticks: number[] = [];
  let t = Math.ceil(start / step) * step;
  if (t <= start) t += step;
  while (t < end) {
    ticks.push(t);
    t += step;
  }
  if (ticks.length === 0) ticks.push(start + span / 2);
  return ticks;
}

export function formatClock(ms: number): string {
  const date = new Date(ms);
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  const seconds = String(date.getUTCSeconds()).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

export function windowStart(now: number, minutes: WindowMinutes): number {
  return now - minutes * 60 * 1000;
}

export function rangesFlatten(seriesList: readonly SeriesHistory[], start: number, end: number): boolean {
  const spans: number[] = [];
  let min = Infinity;
  let max = -Infinity;
  for (const series of seriesList) {
    let low = Infinity;
    let high = -Infinity;
    for (const sample of samplesInWindow(series, start, end)) {
      low = Math.min(low, sample.numeric);
      high = Math.max(high, sample.numeric);
    }
    if (!Number.isFinite(low) || !Number.isFinite(high)) continue;
    spans.push(high - low || Math.abs(low) * 0.05 || 1);
    min = Math.min(min, low);
    max = Math.max(max, high);
  }
  if (spans.length < 2) return false;
  const widest = Math.max(...spans);
  return max - min > widest * 5;
}

export function areaBaseline(rows: readonly PlotRow[]): number {
  let min = Infinity;
  let max = -Infinity;
  for (const row of rows) {
    min = Math.min(min, row.y);
    max = Math.max(max, row.y);
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return 0;
  const span = max - min;
  const pad = span > 0 ? span * 0.2 : Math.abs(min) * 0.05 || 1;
  return min - pad;
}

function barRows(
  series: SeriesHistory,
  label: string,
  inside: readonly Sample[],
  start: number,
  end: number,
): PlotRow[] {
  const slice = barSliceMs(start, end);
  const latest = new Map<number, Sample>();
  for (const sample of inside) {
    const bucket = Math.floor(sample.t / slice) * slice;
    const current = latest.get(bucket);
    if (!current || sample.t >= current.t) latest.set(bucket, sample);
  }
  const rows: PlotRow[] = [];
  for (const [bucket, sample] of latest) {
    rows.push(toRow(label, sample, bucket + slice / 2, `${series.nodeId}:${bucket}`));
  }
  rows.sort((left, right) => left.t - right.t);
  return rows;
}

function toRow(label: string, sample: Sample, t: number, id: string): PlotRow {
  return { id, t, y: sample.numeric, series: label };
}

function trimSamples(samples: Sample[], now: number) {
  const cutoff = now - RETAIN_MS;
  let drop = 0;
  while (drop < samples.length - 1 && samples[drop + 1].t < cutoff) drop += 1;
  if (drop > 0) samples.splice(0, drop);
  const extra = samples.length - MAX_SAMPLES;
  if (extra > 0) samples.splice(0, extra);
}

function eventTime(item: WatchItem, fallback: number): number {
  const parsed = Date.parse(item.sourceTimestamp ?? item.serverTimestamp ?? "");
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return fallback;
}

function csvCell(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}
