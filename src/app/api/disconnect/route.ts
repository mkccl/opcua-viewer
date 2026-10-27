import { NextResponse } from "next/server";

import { clearSessionCookie, errorResponse, sessionIdFromCookie } from "@/lib/http";
import { disconnect } from "@/lib/opcua/manager";


export async function POST() {
  try {
    const id = await sessionIdFromCookie();
    if (id) await disconnect(id);
    await clearSessionCookie();
    return NextResponse.json({ connected: false });
  } catch (error) {
    return errorResponse(error);
  }
}
