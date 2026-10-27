"use client";

import { useEffect, useRef, useState } from "react";

import { AddressTree } from "@/components/address-tree";
import { ConnectForm } from "@/components/connect-form";
import { NodeDetails } from "@/components/node-details";
import { ThemeToggle } from "@/components/theme-toggle";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LiveCharts } from "@/components/live-charts";
import { WatchList } from "@/components/watch-list";
import { ApiError, api } from "@/lib/api";
import type { NodeDetails as NodeDetailsData, SessionResponse, WatchItem } from "@/lib/types";

export function Viewer() {
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [items, setItems] = useState<WatchItem[]>([]);
  const [live, setLive] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [details, setDetails] = useState<NodeDetailsData | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const closeStream = useRef<(() => void) | null>(null);
  const pinned = useRef(new Set<string>());
  const readRequest = useRef(0);
  const connected = session?.connected === true;

  useEffect(() => {
    let ignore = false;
    api<SessionResponse>("/api/session")
      .then((data) => {
        if (ignore) return;
        setSession(data);
        if (data.connected) setItems(data.items);
      })
      .catch(() => {
        if (!ignore) setSession({ connected: false });
      });
    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    if (!connected) return;
    const source = new EventSource("/api/watch/stream");
    closeStream.current = () => source.close();

    source.addEventListener("snapshot", (event) => {
      const snapshot = parseEvent<WatchItem[]>(event);
      if (!snapshot) return;
      setItems((current) => {
        const next = new Map(snapshot.map((item) => [item.nodeId, item]));
        for (const item of current) {
          if (pinned.current.has(item.nodeId) && !next.has(item.nodeId)) {
            next.set(item.nodeId, item);
          }
        }
        return [...next.values()];
      });
    });
    source.addEventListener("value", (event) => {
      const item = parseEvent<WatchItem>(event);
      if (!item) return;
      setItems((current) => {
        const index = current.findIndex((entry) => entry.nodeId === item.nodeId);
        if (index === -1) return [...current, item];
        const next = current.slice();
        next[index] = item;
        return next;
      });
    });
    source.addEventListener("removed", (event) => {
      const body = parseEvent<{ nodeId: string }>(event);
      if (!body) return;
      pinned.current.delete(body.nodeId);
      setItems((current) => current.filter((item) => item.nodeId !== body.nodeId));
    });
    source.addEventListener("session", () => {
      source.close();
      pinned.current.clear();
      setItems([]);
      setSelectedNodeId(null);
      setDetails(null);
      setSession({ connected: false });
    });
    source.onopen = () => setLive(true);
    source.onerror = () => setLive(false);

    return () => {
      source.close();
      closeStream.current = null;
      setLive(false);
    };
  }, [connected]);

  async function readNode(nodeId: string) {
    const requestId = ++readRequest.current;
    setSelectedNodeId(nodeId);
    setDetailsLoading(true);
    setDetailsError(null);
    try {
      const next = await api<NodeDetailsData>(
        `/api/nodes?nodeId=${encodeURIComponent(nodeId)}`,
      );
      if (readRequest.current !== requestId) return;
      setDetails(next);
    } catch (error) {
      if (readRequest.current !== requestId) return;
      setDetails(null);
      setDetailsError(error instanceof ApiError ? error.message : "Could not read that node");
    } finally {
      if (readRequest.current === requestId) setDetailsLoading(false);
    }
  }

  async function watch(nodeId: string) {
    setActionError(null);
    pinned.current.add(nodeId);
    try {
      const item = await api<WatchItem>("/api/watch", {
        method: "POST",
        body: JSON.stringify({ nodeId }),
      });
      setItems((current) => {
        const index = current.findIndex((entry) => entry.nodeId === item.nodeId);
        if (index === -1) return [...current, item];
        const next = current.slice();
        next[index] = item;
        return next;
      });
    } catch (error) {
      pinned.current.delete(nodeId);
      setActionError(error instanceof ApiError ? error.message : "Could not watch that node");
    }
  }

  async function unwatch(nodeId: string) {
    setActionError(null);
    pinned.current.delete(nodeId);
    const previous = items;
    setItems((current) => current.filter((item) => item.nodeId !== nodeId));
    try {
      await api("/api/watch", {
        method: "DELETE",
        body: JSON.stringify({ nodeId }),
      });
    } catch (error) {
      setItems(previous);
      setActionError(error instanceof ApiError ? error.message : "Could not remove that variable");
    }
  }

  async function disconnect() {
    closeStream.current?.();
    setDisconnecting(true);
    try {
      await api("/api/disconnect", { method: "POST" });
    } catch (error) {
      setActionError(error instanceof ApiError ? error.message : "Could not disconnect");
    } finally {
      pinned.current.clear();
      setItems([]);
      setSelectedNodeId(null);
      setDetails(null);
      setSession({ connected: false });
      setDisconnecting(false);
    }
  }

  const watchedIds = new Set(items.map((item) => item.nodeId));
  const watchedDetails = details
    ? items.find((item) => item.nodeId === details.nodeId)
    : undefined;
  const shownDetails = details
    ? watchedDetails
      ? {
          ...details,
          value: watchedDetails.value,
          statusCode: watchedDetails.statusCode,
          sourceTimestamp: watchedDetails.sourceTimestamp,
          serverTimestamp: watchedDetails.serverTimestamp,
        }
      : details
    : null;

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b px-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="font-semibold tracking-tight">OPC UA Client</span>
          {session?.connected ? (
            <Badge variant="outline" className="max-w-[46vw] truncate font-mono font-normal">
              <span className="size-1.5 rounded-full bg-emerald-500" />
              {session.endpointUrl}
            </Badge>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          {session?.connected ? (
            <Button type="button" variant="outline" onClick={() => void disconnect()} disabled={disconnecting}>
              {disconnecting ? "Disconnecting…" : "Disconnect"}
            </Button>
          ) : null}
        </div>
      </header>

      {session === null ? (
        <main className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          Checking session…
        </main>
      ) : session.connected ? (
        <main className="grid min-h-0 flex-1 overflow-auto lg:grid-cols-[minmax(18rem,22rem)_minmax(0,1fr)]">
          <AddressTree
            selectedNodeId={selectedNodeId}
            watchedIds={watchedIds}
            onSelect={(nodeId) => void readNode(nodeId)}
            onWatch={(nodeId) => void watch(nodeId)}
          />
          <div className="flex min-h-0 min-w-0 flex-col lg:overflow-y-auto">
            {actionError ? (
              <div className="px-4 pt-4">
                <Alert variant="destructive">
                  <AlertTitle>Something went wrong</AlertTitle>
                  <AlertDescription>{actionError}</AlertDescription>
                </Alert>
              </div>
            ) : null}
            <NodeDetails
              details={shownDetails}
              loading={detailsLoading}
              error={detailsError}
              watching={details ? watchedIds.has(details.nodeId) : false}
              onRefresh={() => {
                if (selectedNodeId) void readNode(selectedNodeId);
              }}
              onWatch={(nodeId) => void watch(nodeId)}
            />
            <WatchList items={items} live={live} onRemove={(nodeId) => void unwatch(nodeId)} />
            <LiveCharts items={items} live={live} />
          </div>
        </main>
      ) : (
        <main className="flex flex-1 items-center justify-center p-6">
          <ConnectForm
            onConnected={(next) => {
              setActionError(null);
              setItems(next.connected ? next.items : []);
              setSession(next);
            }}
          />
        </main>
      )}
    </div>
  );
}

function parseEvent<T>(event: Event): T | null {
  if (!(event instanceof MessageEvent) || typeof event.data !== "string") return null;
  try {
    return JSON.parse(event.data) as T;
  } catch {
    return null;
  }
}
