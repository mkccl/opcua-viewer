import { NextResponse } from "next/server";

import {
  currentSession,
  errorResponse,
  nodeIdFrom,
  notConnected,
  readJson,
} from "@/lib/http";
import { addWatch, listWatch, removeWatch } from "@/lib/opcua/manager";


export async function GET() {
  try {
    const held = await currentSession();
    if (!held) return notConnected();
    return NextResponse.json({ items: listWatch(held) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const held = await currentSession();
    if (!held) return notConnected();
    const item = await addWatch(held, nodeIdFrom(request.url, await readJson(request)));
    return NextResponse.json(item);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const held = await currentSession();
    if (!held) return notConnected();
    await removeWatch(held, nodeIdFrom(request.url, await readJson(request)));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
