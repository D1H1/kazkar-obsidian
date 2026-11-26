// Synthetic campaign shaped exactly like Kazkar's MCP responses.
import type { Campaign, LoreEntityDetail, SessionListItem, SessionRecap } from "../src/types";

export const C1 = "11111111-1111-4111-8111-111111111111";
export const S1 = "22222222-2222-4222-8222-222222222222";
export const S2 = "22222222-2222-4222-8222-333333333333";
export const S_FAILED = "22222222-2222-4222-8222-444444444444";
export const E_MIRA = "33333333-3333-4333-8333-111111111111";
export const E_HOLLOW = "33333333-3333-4333-8333-222222222222";
export const E_LANTERN = "33333333-3333-4333-8333-333333333333";
export const E_GONE = "33333333-3333-4333-8333-999999999999";

export const campaign: Campaign = {
  id: C1, name: "The Sunken Bell", system: "D&D 5e", description: "A drowned village rings its bell again.",
  is_public: false, created_at: "2026-01-01T00:00:00Z", author: "Ash", role: "owner",
};

export const sessions: SessionListItem[] = [
  { id: S_FAILED, campaign_id: C1, started_at: "2026-03-10T18:00:00Z", ended_at: null, duration_minutes: 3, status: "failed", recap_title: null },
  { id: S2, campaign_id: C1, started_at: "2026-03-03T18:00:00Z", ended_at: "2026-03-03T21:00:00Z", duration_minutes: 180, status: "completed", recap_title: "Lanterns: Over the Hollow?" },
  { id: S1, campaign_id: C1, started_at: "2026-02-24T18:00:00Z", ended_at: "2026-02-24T21:00:00Z", duration_minutes: 170, status: "completed", recap_title: "The Bell Wakes" },
];

const recapBase = { campaign_id: C1, status: "completed", word_count: 40 };

export const recaps: Record<string, SessionRecap> = {
  [S1]: {
    ...recapBase, id: S1, started_at: sessions[2].started_at, duration_minutes: 170, title: "The Bell Wakes",
    narrative: "Mira waded into Drowned Hollow at dusk. In Drowned Hollow the water was cold; Mira did not care. Admiral did not appear.",
    highlights: ["@[Mira](" + E_MIRA + ") heard the bell under @[Drowned Hollow](" + E_HOLLOW + ")."],
    epilogue: "The bell kept ringing.",
    bullet_summary: { key_events: ["Found @[Ghost Ship](" + E_GONE + ")"], action_items: ["Return to @[Drowned Hollow](" + E_HOLLOW + ")"], combat_highlights: [], funny_moments: ["[]", " "] },
  },
  [S2]: {
    ...recapBase, id: S2, started_at: sessions[1].started_at, duration_minutes: 180, title: "Lanterns: Over the Hollow?",
    narrative: "Mira lit the Storm Lantern.", highlights: null, epilogue: null, bullet_summary: null,
  },
};

const ent = { campaign_id: C1, created_at: "2026-02-24T00:00:00Z", updated_at: "2026-03-03T00:00:00Z" };

export const entities: LoreEntityDetail[] = [
  { ...ent, id: E_MIRA, entity_type: "character", name: "Mira", aliases: ["the diver", "Mira"], status: "active",
    description: "A diver who trusts @[Drowned Hollow](" + E_HOLLOW + ") too much.",
    properties: { race: "human", image_url: "/avatars/portraits/001.webp", languages: ["Common", "Aquan"] },
    relations: [
      { source_entity_id: E_MIRA, target_entity_id: E_LANTERN, relation_type: "owns", description: null, session_id: S2 },
      { source_entity_id: E_HOLLOW, target_entity_id: E_MIRA, relation_type: "haunts", description: "The hollow calls to her.", session_id: S1 },
    ],
    timeline: [
      { session_id: S1, update_text: "Heard the bell.", created_at: "2026-02-24T22:00:00Z" },
      { session_id: null, update_text: "Added by hand.", created_at: "2026-02-25T10:00:00Z" },
    ] },
  { ...ent, id: E_HOLLOW, entity_type: "location", name: "Drowned Hollow", aliases: [], status: null,
    description: "A flooded village.", properties: {}, relations: [], timeline: [] },
  { ...ent, id: E_LANTERN, entity_type: "item", name: "Storm Lantern", aliases: [], status: "active",
    description: null, properties: { effect: "Burns underwater." }, relations: [], timeline: [] },
];
