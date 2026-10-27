"use client";

import { ChevronRight } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ApiError, api } from "@/lib/api";
import { OBJECTS_FOLDER_NODE_ID, type TreeNode } from "@/lib/types";
import { cn } from "@/lib/utils";

type NodeState = TreeNode & {
  expanded: boolean;
  loaded: boolean;
  loading: boolean;
  error: string | null;
  children: NodeState[];
};

export function AddressTree({
  selectedNodeId,
  watchedIds,
  onSelect,
  onWatch,
}: {
  selectedNodeId: string | null;
  watchedIds: Set<string>;
  onSelect: (nodeId: string) => void;
  onWatch: (nodeId: string) => void;
}) {
  const [nodes, setNodes] = useState<NodeState[]>([
    {
      nodeId: OBJECTS_FOLDER_NODE_ID,
      browseName: "Objects",
      displayName: "Objects",
      nodeClass: "Object",
      expanded: true,
      loaded: false,
      loading: true,
      error: null,
      children: [],
    },
  ]);

  const loadChildren = useCallback(async (nodeId: string) => {
    setNodes((current) =>
      updateNode(current, nodeId, (node) => ({
        ...node,
        expanded: true,
        loading: true,
        error: null,
      })),
    );
    try {
      const data = await api<{ nodes: TreeNode[] }>(
        `/api/browse?nodeId=${encodeURIComponent(nodeId)}`,
      );
      setNodes((current) =>
        updateNode(current, nodeId, (node) => ({
          ...node,
          expanded: true,
          loaded: true,
          loading: false,
          error: null,
          children: data.nodes.map(toNodeState),
        })),
      );
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "Browse failed";
      setNodes((current) =>
        updateNode(current, nodeId, (node) => ({
          ...node,
          expanded: true,
          loading: false,
          error: message,
        })),
      );
    }
  }, []);

  useEffect(() => {
    let ignore = false;
    api<{ nodes: TreeNode[] }>(
      `/api/browse?nodeId=${encodeURIComponent(OBJECTS_FOLDER_NODE_ID)}`,
    )
      .then((data) => {
        if (ignore) return;
        setNodes((current) =>
          updateNode(current, OBJECTS_FOLDER_NODE_ID, (node) => ({
            ...node,
            expanded: true,
            loaded: true,
            loading: false,
            error: null,
            children: data.nodes.map(toNodeState),
          })),
        );
      })
      .catch((error: unknown) => {
        if (ignore) return;
        const message = error instanceof ApiError ? error.message : "Browse failed";
        setNodes((current) =>
          updateNode(current, OBJECTS_FOLDER_NODE_ID, (node) => ({
            ...node,
            expanded: true,
            loading: false,
            error: message,
          })),
        );
      });
    return () => {
      ignore = true;
    };
  }, []);

  function toggle(node: NodeState) {
    if (node.loading) return;
    if (node.expanded) {
      setNodes((current) =>
        updateNode(current, node.nodeId, (item) => ({ ...item, expanded: false })),
      );
      return;
    }
    if (node.loaded) {
      setNodes((current) =>
        updateNode(current, node.nodeId, (item) => ({ ...item, expanded: true })),
      );
      return;
    }
    void loadChildren(node.nodeId);
  }

  return (
    <section className="flex min-h-80 flex-col border-b lg:min-h-0 lg:border-r lg:border-b-0">
      <div className="flex h-11 shrink-0 items-center border-b px-3">
        <h2 className="text-sm font-medium">Address space</h2>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-2">
          <TreeLevel
            nodes={nodes}
            depth={0}
            selectedNodeId={selectedNodeId}
            watchedIds={watchedIds}
            onToggle={toggle}
            onSelect={onSelect}
            onWatch={onWatch}
            onRetry={(nodeId) => void loadChildren(nodeId)}
          />
        </div>
      </ScrollArea>
    </section>
  );
}

function TreeLevel({
  nodes,
  depth,
  selectedNodeId,
  watchedIds,
  onToggle,
  onSelect,
  onWatch,
  onRetry,
}: {
  nodes: NodeState[];
  depth: number;
  selectedNodeId: string | null;
  watchedIds: Set<string>;
  onToggle: (node: NodeState) => void;
  onSelect: (nodeId: string) => void;
  onWatch: (nodeId: string) => void;
  onRetry: (nodeId: string) => void;
}) {
  return (
    <ul className="flex flex-col">
      {nodes.map((node) => {
        const selected = node.nodeId === selectedNodeId;
        const leaf = node.loaded && node.children.length === 0;
        return (
          <li key={node.nodeId}>
            <div
              className={cn(
                "flex items-center gap-1 rounded-md pr-1",
                selected && "bg-accent",
              )}
              style={{ paddingLeft: depth * 12 }}
            >
              <button
                type="button"
                className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
                aria-label={node.expanded ? `Collapse ${node.displayName}` : `Expand ${node.displayName}`}
                aria-expanded={node.expanded}
                disabled={leaf}
                onClick={() => onToggle(node)}
              >
                {leaf ? (
                  <span className="size-3.5" />
                ) : (
                  <ChevronRight
                    className={cn("size-3.5 transition-transform", node.expanded && "rotate-90")}
                  />
                )}
              </button>
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-2 py-1 text-left"
                title={node.nodeId}
                onClick={() => onSelect(node.nodeId)}
              >
                <Badge variant={node.nodeClass === "Variable" ? "default" : "secondary"}>
                  {node.nodeClass}
                </Badge>
                <span className="truncate text-sm">{node.displayName}</span>
              </button>
              {node.nodeClass === "Variable" ? (
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  disabled={watchedIds.has(node.nodeId)}
                  onClick={() => onWatch(node.nodeId)}
                >
                  {watchedIds.has(node.nodeId) ? "Watching" : "Watch"}
                </Button>
              ) : null}
            </div>
            {node.expanded && node.loading ? (
              <p className="px-3 py-1 text-xs text-muted-foreground" style={{ paddingLeft: (depth + 1) * 12 + 28 }}>
                Loading…
              </p>
            ) : null}
            {node.expanded && node.error ? (
              <p className="flex items-center gap-2 px-3 py-1 text-xs text-destructive" style={{ paddingLeft: (depth + 1) * 12 + 28 }}>
                {node.error}
                <button type="button" className="underline" onClick={() => onRetry(node.nodeId)}>
                  Retry
                </button>
              </p>
            ) : null}
            {node.expanded && node.loaded && node.children.length === 0 ? (
              <p className="px-3 py-1 text-xs text-muted-foreground" style={{ paddingLeft: (depth + 1) * 12 + 28 }}>
                No children
              </p>
            ) : null}
            {node.expanded && node.loaded && node.children.length > 0 ? (
              <TreeLevel
                nodes={node.children}
                depth={depth + 1}
                selectedNodeId={selectedNodeId}
                watchedIds={watchedIds}
                onToggle={onToggle}
                onSelect={onSelect}
                onWatch={onWatch}
                onRetry={onRetry}
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function toNodeState(node: TreeNode): NodeState {
  return {
    ...node,
    expanded: false,
    loaded: false,
    loading: false,
    error: null,
    children: [],
  };
}

function updateNode(
  nodes: NodeState[],
  nodeId: string,
  updater: (node: NodeState) => NodeState,
): NodeState[] {
  return nodes.map((node) => {
    if (node.nodeId === nodeId) return updater(node);
    if (node.children.length === 0) return node;
    return { ...node, children: updateNode(node.children, nodeId, updater) };
  });
}
