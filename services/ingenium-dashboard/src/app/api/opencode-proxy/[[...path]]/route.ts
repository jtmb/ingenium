import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const TARGET = "http://localhost:4096";

async function handler(req: NextRequest) {
  const pass = process.env.OPENCODE_SERVER_PASSWORD ?? "";
  const auth = Buffer.from(`opencode:${pass}`).toString("base64");

  const path = req.nextUrl.pathname.replace("/api/opencode-proxy", "") || "/";
  const url = `${TARGET}${path}${req.nextUrl.search}`;

  const headers = new Headers(req.headers);
  headers.set("Authorization", `Basic ${auth}`);
  headers.delete("host");

  const body = ["GET", "HEAD"].includes(req.method) ? undefined : await req.arrayBuffer();

  try {
    const resp = await fetch(url, {
      method: req.method,
      headers,
      body: body ? new Uint8Array(body) : undefined,
      redirect: "manual",
    });

    const responseHeaders = new Headers(resp.headers);
    responseHeaders.delete("content-encoding");
    responseHeaders.delete("transfer-encoding");

    return new NextResponse(resp.body, {
      status: resp.status,
      statusText: resp.statusText,
      headers: responseHeaders,
    });
  } catch {
    return new NextResponse("Proxy error", { status: 502 });
  }
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const OPTIONS = handler;
export const HEAD = handler;
