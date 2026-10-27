import "server-only";

const ACCESS_FLAGS: Array<[number, string]> = [
  [0x01, "CurrentRead"],
  [0x02, "CurrentWrite"],
  [0x04, "HistoryRead"],
  [0x08, "HistoryWrite"],
  [0x10, "SemanticChange"],
  [0x20, "StatusWrite"],
  [0x40, "TimestampWrite"],
];

export function formatBrowseName(value: unknown): string | null {
  if (typeof value === "string") return value || null;
  if (!value || typeof value !== "object") return null;
  const record = value as { namespaceIndex?: unknown; name?: unknown };
  const name = typeof record.name === "string" ? record.name : "";
  if (!name) return null;
  const namespaceIndex =
    typeof record.namespaceIndex === "number" ? record.namespaceIndex : 0;
  return namespaceIndex ? `${namespaceIndex}:${name}` : name;
}

export function formatLocalizedText(value: unknown): string | null {
  if (typeof value === "string") return value || null;
  if (!value || typeof value !== "object") return null;
  const text = (value as { text?: unknown }).text;
  return typeof text === "string" && text.length > 0 ? text : null;
}

export function formatAccessLevel(value: unknown): string | null {
  const bits = asNumber(value);
  if (bits === null) return null;
  const names = ACCESS_FLAGS.filter(([bit]) => (bits & bit) !== 0).map(
    ([, name]) => name,
  );
  return names.length > 0 ? names.join(", ") : "None";
}

export function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return formatNumber(value);
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) {
    return Buffer.from(value).toString("hex");
  }
  if (Array.isArray(value)) {
    return value.map((item) => formatValue(item)).join(", ");
  }
  if (typeof value === "object") {
    if ("toString" in value && value.toString !== Object.prototype.toString) {
      const text = String(value);
      if (text && !text.startsWith("[object ")) return text;
    }
    try {
      return JSON.stringify(value, (_key, nested) =>
        typeof nested === "bigint" ? nested.toString() : nested,
      );
    } catch {
      return String(value);
    }
  }
  return String(value);
}

export function formatTimestamp(date: Date | null | undefined): string | null {
  if (!date || Number.isNaN(date.getTime()) || date.getTime() <= 0) return null;
  return date.toISOString();
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  if (Number.isInteger(value)) return String(value);
  return String(Math.round(value * 1000) / 1000);
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  if (value && typeof value === "object" && "valueOf" in value) {
    const numeric = Number(value.valueOf());
    return Number.isFinite(numeric) ? numeric : null;
  }
  return null;
}
