// Shapes returned by Kazkar's MCP tools (see kazkar.ai/api/mcp).

export interface Campaign {
  id: string;
  name: string;
  system: string | null;
  description: string | null;
  is_public: boolean;
  created_at: string;
  author: string | null;
  role: "owner" | "player";
}

export interface SessionListItem {
  id: string;
  campaign_id: string;
  started_at: string;
  ended_at: string | null;
  duration_minutes: number | null;
  status: string;
  recap_title: string | null;
}

export interface BulletSummary {
  key_events?: string[];
  decisions_made?: string[];
  action_items?: string[];
  funny_moments?: string[];
  combat_highlights?: string[];
  [k: string]: string[] | undefined;
}

export interface SessionRecap {
  id: string;
  campaign_id: string;
  started_at: string;
  duration_minutes: number | null;
  status: string;
  title: string | null;
  narrative: string | null;
  word_count: number;
  highlights: string[] | null;
  epilogue: string | null;
  bullet_summary: BulletSummary | null;
}

export interface LoreEntity {
  id: string;
  campaign_id: string;
  entity_type: string;
  name: string;
  aliases: string[];
  status: string | null;
  description: string | null;
  properties: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface LoreRelation {
  source_entity_id: string;
  target_entity_id: string;
  relation_type: string;
  description: string | null;
  session_id: string | null;
}

export interface LoreTimelineEntry {
  session_id: string | null;
  update_text: string;
  created_at: string;
}

export interface LoreEntityDetail extends LoreEntity {
  relations: LoreRelation[];
  timeline: LoreTimelineEntry[];
}
