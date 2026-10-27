import { NextResponse } from "next/server";

import { currentSession, errorResponse } from "@/lib/http";
import { listWatch, sessionInfo } from "@/lib/opcua/manager";


export async function GET() {
  try {
    const held = await currentSession();
    if (!held) return NextResponse.json({ connected: false });
    return NextResponse.json({
      connected: true,
      ...sessionInfo(held),
      items: listWatch(held),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
