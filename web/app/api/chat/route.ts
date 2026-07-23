import { NextRequest } from "next/server";

export const runtime = "nodejs";

// Chat orchestration lives in the retriever service.
const RETRIEVER_URL = process.env.RETRIEVER_URL ?? "http://localhost:8100";

export async function POST(req: NextRequest) {
  const body = await req.json();
  if (!body?.query || typeof body.query !== "string") {
    return new Response("query required", { status: 400 });
  }
  try {
    const auth = req.headers.get("authorization");
    const upstream = await fetch(`${RETRIEVER_URL}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(auth ? { Authorization: auth } : {}) },
      body: JSON.stringify({
        query: body.query,
        collection: body.collection ?? "ccragos_chunks",
        top_k: Math.min(Math.max(Number(body.top_k) || 5, 1), 20),
        model: body.model ?? null,
        prompt_style: ["standard", "cot", "concise"].includes(body.prompt_style) ? body.prompt_style : "standard",
        strategy: ["semantic", "hybrid", "hyde", "graphrag"].includes(body.strategy) ? body.strategy : "semantic",
        rerank: Boolean(body.rerank),
        sources: Array.isArray(body.sources) ? body.sources.slice(0, 200) : [],
        images: Array.isArray(body.images) ? body.images.slice(0, 3) : [],
      }),
    });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    return Response.json({ error: `retriever unreachable: ${(e as Error).message}` }, { status: 502 });
  }
}
