import { NextResponse } from "next/server";

import { currentSession, errorResponse, nodeIdFrom, notConnected } from "@/lib/http";
import { browse } from "@/lib/opcua/manager";


export async function GET(request: Request) {
  try {
    const held = await currentSession();
    if (!held) return notConnected();
    const nodes = await browse(held, nodeIdFrom(request.url));
    return NextResponse.json({ nodes });
  } catch (error) {
    return errorResponse(error);
  }
}
