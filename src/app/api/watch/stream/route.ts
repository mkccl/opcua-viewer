import { addListener, listWatch, type SessionEvent } from "@/lib/opcua/manager";
import { currentSession, notConnected } from "@/lib/http";


export async function GET() {
  const held = await currentSession();
  if (!held) return notConnected();

  const encoder = new TextEncoder();
  let unsubscribe = () => {};
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      const onEvent = (event: SessionEvent) => {
        if (event.type === "value") send("value", event.item);
        else if (event.type === "removed") send("removed", { nodeId: event.nodeId });
        else send("session", { connected: false });
      };

      send("snapshot", listWatch(held));
      unsubscribe = addListener(held, onEvent);
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          if (heartbeat) clearInterval(heartbeat);
        }
      }, 15_000);
    },
    cancel() {
      if (heartbeat) clearInterval(heartbeat);
      unsubscribe();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
