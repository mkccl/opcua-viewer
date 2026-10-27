import { NextResponse } from "next/server";

import {
  errorResponse,
  readJson,
  sessionIdFromCookie,
  setSessionCookie,
} from "@/lib/http";
import { connect, sessionInfo } from "@/lib/opcua/manager";


export async function POST(request: Request) {
  try {
    const previousId = await sessionIdFromCookie();
    const held = await connect(await readJson(request), previousId);
    await setSessionCookie(held.id);
    return NextResponse.json({
      connected: true,
      ...sessionInfo(held),
      items: [],
    });
  } catch (error) {
    return errorResponse(error);
  }
}
