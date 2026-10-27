"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { NodeDetails } from "@/lib/types";

export function NodeDetails({
  details,
  loading,
  error,
  watching,
  onRefresh,
  onWatch,
}: {
  details: NodeDetails | null;
  loading: boolean;
  error: string | null;
  watching: boolean;
  onRefresh: () => void;
  onWatch: (nodeId: string) => void;
}) {
  return (
    <section className="border-b px-4 py-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium">Node</h2>
        {details ? (
          <div className="flex items-center gap-2">
            <Button type="button" size="sm" variant="outline" onClick={onRefresh} disabled={loading}>
              {loading ? "Reading…" : "Refresh"}
            </Button>
            {details.nodeClass === "Variable" ? (
              <Button
                type="button"
                size="sm"
                disabled={watching}
                onClick={() => onWatch(details.nodeId)}
              >
                {watching ? "Watching" : "Watch"}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {!details && !loading && !error ? (
        <p className="text-sm text-muted-foreground">Select a node in the address space.</p>
      ) : null}
      {loading && !details ? <p className="text-sm text-muted-foreground">Reading…</p> : null}
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Could not read the node</AlertTitle>
          <AlertDescription className="break-words">{error}</AlertDescription>
        </Alert>
      ) : null}
      {details ? <DetailBody details={details} /> : null}
    </section>
  );
}

function DetailBody({ details }: { details: NodeDetails }) {
  const rows: Array<[string, string | null]> = [
    ["NodeId", details.nodeId],
    ["BrowseName", details.browseName],
    ["DisplayName", details.displayName],
    ["NodeClass", details.nodeClass],
    ["DataType", details.dataType],
    ["AccessLevel", details.accessLevel],
    ["Description", details.description],
  ];

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(16rem,0.8fr)]">
      <dl className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="col-span-2 grid grid-cols-subgrid">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="break-words font-mono text-[13px]">{value || "—"}</dd>
          </div>
        ))}
      </dl>
      <div className="rounded-lg bg-muted/60 p-3 ring-1 ring-foreground/10">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Value
          </span>
          {details.statusCode ? (
            <Badge variant={details.statusCode === "Good" ? "secondary" : "destructive"}>
              {details.statusCode}
            </Badge>
          ) : (
            <span className="text-xs text-muted-foreground">No value</span>
          )}
        </div>
        <p className="mt-2 font-mono text-2xl break-all tabular-nums">
          {details.value ?? "—"}
        </p>
        <dl className="mt-3 grid gap-1 text-xs text-muted-foreground">
          <div className="flex justify-between gap-3">
            <dt>Source</dt>
            <dd className="font-mono">{showTime(details.sourceTimestamp)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt>Server</dt>
            <dd className="font-mono">{showTime(details.serverTimestamp)}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

function showTime(iso: string | null) {
  if (!iso) return "—";
  return iso.replace("T", " ").replace("Z", " UTC");
}
