import "server-only";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { ClientError, getSession, touch } from "@/lib/opcua/manager";

export const COOKIE_NAME = "opcua_sid";

const cookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
};

export async function currentSession() {
  const jar = await cookies();
  const id = jar.get(COOKIE_NAME)?.value;
  if (!id) return null;
  const held = getSession(id);
  if (!held) {
    jar.delete(COOKIE_NAME);
    return null;
  }
  touch(held);
  return held;
}

export async function sessionIdFromCookie() {
  const jar = await cookies();
  return jar.get(COOKIE_NAME)?.value;
}

export async function setSessionCookie(id: string) {
  const jar = await cookies();
  jar.set(COOKIE_NAME, id, cookieOptions);
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ClientError("Expected a JSON body");
  }
}

export function nodeIdFrom(requestUrl: string, body?: unknown): string {
  const url = new URL(requestUrl);
  const fromQuery = url.searchParams.get("nodeId");
  if (fromQuery) return fromQuery;
  if (body && typeof body === "object" && "nodeId" in body) {
    const nodeId = (body as { nodeId?: unknown }).nodeId;
    if (typeof nodeId === "string") return nodeId;
  }
  throw new ClientError("A node id is required");
}

export function errorResponse(error: unknown) {
  if (error instanceof ClientError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  const message =
    error instanceof Error && error.message ? error.message : "Unexpected error";
  return NextResponse.json({ error: message }, { status: 500 });
}

export function notConnected() {
  return NextResponse.json({ error: "Not connected" }, { status: 401 });
}
