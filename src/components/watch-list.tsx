"use client";

import { X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { WatchItem } from "@/lib/types";
import { cn } from "@/lib/utils";

export function WatchList({
  items,
  live,
  onRemove,
}: {
  items: WatchItem[];
  live: boolean;
  onRemove: (nodeId: string) => void;
}) {

  return (
    <section className="flex min-h-72 min-w-0 flex-1 flex-col">
      <div className="flex h-11 shrink-0 items-center justify-between gap-3 border-b px-4">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium">Watch list</h2>
          <Badge variant="outline">{items.length}</Badge>
        </div>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className={cn("size-1.5 rounded-full", live ? "bg-emerald-500" : "bg-muted-foreground")} />
          {live ? "Live" : "Connecting"}
        </span>
      </div>
      {items.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">
          No watched variables. Use Watch on a variable in the tree or the node panel.
        </p>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full min-w-[46rem] text-sm">
            <thead className="sticky top-0 bg-background">
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">NodeId</th>
                <th className="px-3 py-2 font-medium">Value</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Source time</th>
                <th className="px-3 py-2 font-medium">Server time</th>
                <th className="px-3 py-2 font-medium">
                  <span className="sr-only">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.nodeId} className="border-b">
                  <td className="px-4 py-2">{item.displayName}</td>
                  <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{item.nodeId}</td>
                  <td className="px-3 py-2 font-mono tabular-nums">
                    <span
                      key={`${item.value ?? ""}|${item.sourceTimestamp ?? ""}`}
                      className="rounded px-1 motion-safe:animate-[value-flash_700ms_ease-out]"
                    >
                      {item.value ?? "—"}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {item.statusCode ? (
                      <Badge variant={item.statusCode === "Good" ? "secondary" : "destructive"}>
                        {item.statusCode}
                      </Badge>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{showTime(item.sourceTimestamp)}</td>
                  <td className="px-3 py-2 font-mono text-xs">{showTime(item.serverTimestamp)}</td>
                  <td className="px-3 py-2 text-right">
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Remove ${item.displayName}`}
                      onClick={() => onRemove(item.nodeId)}
                    >
                      <X />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function showTime(iso: string | null) {
  if (!iso) return "—";
  return iso.replace("T", " ").replace("Z", " UTC");
}
