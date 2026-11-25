// A local stand-in for kazkar.ai/api/mcp built on the official MCP SDK
// (stateless streamable HTTP, SSE responses) and returning tool results in the
// same "<summary>\n\n<json>" + structuredContent format as the real route.
import http from "node:http";
import type { AddressInfo } from "node:net";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { campaign, entities, recaps, sessions } from "./fixtures";

export const GOOD_KEY = "kzk_mcp_test";

function result(data: unknown, summary: string) {
  const isObj = typeof data === "object" && data !== null && !Array.isArray(data);
  return {
    content: [{ type: "text" as const, text: `${summary}\n\n${JSON.stringify(data, null, 2)}` }],
    ...(isObj ? { structuredContent: data as Record<string, unknown> } : {}),
  };
}

// Paginate in pages of 2 to exercise cursor following.
function page<T>(items: T[], cursor?: string) {
  const offset = cursor ? Number(cursor) : 0;
  const slice = items.slice(offset, offset + 2);
  return { slice, nextCursor: offset + 2 < items.length ? String(offset + 2) : undefined };
}

function buildServer() {
  const s = new McpServer({ name: "kazkar-mock", version: "1.0.0" });
  const pg = { limit: z.number().optional(), cursor: z.string().optional() };
  s.registerTool("list_campaigns", { inputSchema: pg }, async ({ cursor }) => {
    const p = page([campaign], cursor);
    return result({ campaigns: p.slice, nextCursor: p.nextCursor }, "campaigns");
  });
  s.registerTool("list_sessions", { inputSchema: { campaign_id: z.string(), ...pg } }, async ({ cursor }) => {
    const p = page(sessions, cursor);
    return result({ sessions: p.slice, nextCursor: p.nextCursor }, "sessions");
  });
  s.registerTool("get_session_recap", { inputSchema: { session_id: z.string() } }, async ({ session_id }) =>
    result(recaps[session_id] ?? null, "recap"));
  s.registerTool("list_lore_entities", { inputSchema: { campaign_id: z.string(), entity_type: z.string().optional(), ...pg } }, async ({ cursor }) => {
    const list = entities.map(({ relations: _r, timeline: _t, ...e }) => e);
    const p = page(list, cursor);
    return result({ entities: p.slice, nextCursor: p.nextCursor }, "entities");
  });
  s.registerTool("get_lore_entity", { inputSchema: { entity_id: z.string() } }, async ({ entity_id }) =>
    result(entities.find((e) => e.id === entity_id) ?? null, "entity"));
  return s;
}

export async function startMockServer(): Promise<{ url: string; calls: string[]; close: () => Promise<void> }> {
  const calls: string[] = [];
  const server = http.createServer(async (req, res) => {
    if (req.url !== "/api/mcp" || req.method !== "POST") { res.writeHead(404).end(); return; }
    if (req.headers.authorization !== `Bearer ${GOOD_KEY}`) { res.writeHead(401).end("Unauthorized"); return; }
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    calls.push(body.params?.name ?? body.method);
    const mcp = buildServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => { void transport.close(); void mcp.close(); });
    await mcp.connect(transport);
    await transport.handleRequest(req, res, body);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, calls, close: () => new Promise((r) => server.close(() => r())) };
}
