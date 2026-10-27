import { NextResponse } from "next/server";

import { currentSession, errorResponse, nodeIdFrom, notConnected } from "@/lib/http";
import { readDetails } from "@/lib/opcua/manager";


export async function GET(request: Request) {
  try {
    const held = await currentSession();
    if (!held) return notConnected();
    const details = await readDetails(held, nodeIdFrom(request.url));
    return NextResponse.json(details);
  } catch (error) {
    return errorResponse(error);
  }
}
