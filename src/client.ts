// Minimal client for Kazkar's hosted MCP endpoint (streamable HTTP, stateless).
// The server is stateless, so each tool call is one JSON-RPC POST; the response
// arrives either as plain JSON or as a single SSE `data:` event.

import type { Campaign, LoreEntity, LoreEntityDetail, SessionListItem, SessionRecap } from "./types";

export interface HttpResponse {
  status: number;
  text: string;
}

/** POST transport. Injected so the plugin can use Obsidian's requestUrl (no CORS) and tests can use fetch. */
export type HttpPost = (url: string, headers: Record<string, string>, body: string) => Promise<HttpResponse>;

export class KazkarAuthError extends Error {}
export class KazkarApiError extends Error {}

interface JsonRpcResponse {
  id?: number | string;
  result?: {
    isError?: boolean;
    structuredContent?: unknown;
    content?: { type: string; text?: string }[];
  };
  error?: { code: number; message: string };
}

/** Pull the JSON-RPC message out of either a JSON body or an SSE stream. */
export function parseRpcBody(text: string): JsonRpcResponse {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) return JSON.parse(trimmed) as JsonRpcResponse;
  // SSE: events separated by blank lines; each may have several `data:` lines.
  for (const event of trimmed.split(/\r?\n\r?\n/)) {
    const data = event
      .split(/\r?\n/)
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).replace(/^ /, ""))
      .join("\n");
    if (!data) continue;
    const msg = JSON.parse(data) as JsonRpcResponse;
    if (msg.result !== undefined || msg.error !== undefined) return msg;
  }
  throw new KazkarApiError("Empty response from Kazkar.");
}

/** Tool text blocks are "<summary>\n\n<json>"; used when structuredContent is absent (arrays, null). */
function dataFromText(text: string): unknown {
  const idx = text.indexOf("\n\n");
  const json = idx >= 0 ? text.slice(idx + 2) : text;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export class KazkarClient {
  private nextId = 1;

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly post: HttpPost
  ) {}

  get endpoint(): string {
    return `${this.baseUrl.replace(/\/+$/, "")}/api/mcp`;
  }

  async callTool<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: this.nextId++,
      method: "tools/call",
      params: { name, arguments: args },
    });
    const res = await this.post(
      this.endpoint,
      {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${this.apiKey}`,
        "MCP-Protocol-Version": "2025-06-18",
      },
      body
    );
    if (res.status === 401 || res.status === 403) {
      throw new KazkarAuthError("Kazkar rejected the API key. Create a new key under Dashboard → Connections.");
    }
    if (res.status === 429) throw new KazkarApiError("Kazkar is rate limiting requests. Try again in a minute.");
    if (res.status < 200 || res.status >= 300) {
      throw new KazkarApiError(`Kazkar returned HTTP ${res.status}.`);
    }
    const msg = parseRpcBody(res.text);
    if (msg.error) throw new KazkarApiError(msg.error.message);
    const result = msg.result;
    if (!result) throw new KazkarApiError("Malformed response from Kazkar.");
    const text = result.content?.find((c) => c.type === "text")?.text ?? "";
    if (result.isError) throw new KazkarApiError(text || "Kazkar returned an error.");
    if (result.structuredContent !== undefined) return result.structuredContent as T;
    return dataFromText(text) as T;
  }

  /** Follow opaque cursors until exhausted. */
  private async paginate<T>(name: string, args: Record<string, unknown>, key: string): Promise<T[]> {
    const out: T[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 200; page++) {
      const data = await this.callTool<Record<string, unknown>>(name, { ...args, limit: 50, ...(cursor ? { cursor } : {}) });
      out.push(...((data?.[key] as T[]) ?? []));
      cursor = data?.nextCursor as string | undefined;
      if (!cursor) break;
    }
    return out;
  }

  listCampaigns(): Promise<Campaign[]> {
    return this.paginate<Campaign>("list_campaigns", {}, "campaigns");
  }

  listSessions(campaignId: string): Promise<SessionListItem[]> {
    return this.paginate<SessionListItem>("list_sessions", { campaign_id: campaignId }, "sessions");
  }

  getSessionRecap(sessionId: string): Promise<SessionRecap | null> {
    return this.callTool<SessionRecap | null>("get_session_recap", { session_id: sessionId });
  }

  listLoreEntities(campaignId: string): Promise<LoreEntity[]> {
    return this.paginate<LoreEntity>("list_lore_entities", { campaign_id: campaignId }, "entities");
  }

  getLoreEntity(entityId: string): Promise<LoreEntityDetail | null> {
    return this.callTool<LoreEntityDetail | null>("get_lore_entity", { entity_id: entityId });
  }
}
