// Pure Markdown rendering: Kazkar data → Obsidian notes. No Obsidian imports, so it
// is unit-testable under plain Node.

import type { BulletSummary, Campaign, LoreEntity, LoreEntityDetail, SessionListItem, SessionRecap } from "./types";

/** Line separating Kazkar-managed content from the user's own notes in the same file. */
export const USER_NOTES_MARKER = "%% kazkar:end — write below this line; Kazkar sync keeps it %%";
const MARKER_PREFIX = "%% kazkar:end";

export const SITE_URL = "https://kazkar.ai";
const UTM = "utm_source=obsidian&utm_medium=plugin&utm_campaign=obsidian_plugin";

/** Where each note lives (vault basename without .md), so links resolve. */
export interface LinkMap {
  campaign: string;
  entities: Map<string, { link: string; name: string; type: string }>;
  sessions: Map<string, { link: string; label: string }>;
}

// ---------------------------------------------------------------------------
// Names & paths

/** Strip characters Obsidian forbids in file names or that break wikilinks. */
export function sanitizeFileName(name: string): string {
  const printable = [...name].filter((ch) => ch.charCodeAt(0) >= 32).join("");
  const cleaned = printable
    .replace(/[\\/:*?"<>|#^[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .slice(0, 120)
    .trim();
  return cleaned || "Untitled";
}

const TYPE_FOLDERS: Record<string, string> = {
  character: "Characters",
  npc: "Characters",
  location: "Locations",
  place: "Locations",
  item: "Items",
  faction: "Factions",
  organization: "Factions",
  event: "Events",
  creature: "Creatures",
};

export function typeFolder(entityType: string): string {
  const known = TYPE_FOLDERS[entityType.toLowerCase()];
  if (known) return known;
  const t = sanitizeFileName(entityType);
  return t.charAt(0).toUpperCase() + t.slice(1) + (t.endsWith("s") ? "" : "s");
}

export function sessionDate(iso: string): string {
  return iso.slice(0, 10);
}

export function sessionBaseName(s: Pick<SessionListItem, "started_at" | "recap_title">): string {
  return sanitizeFileName(`${sessionDate(s.started_at)} ${s.recap_title ?? "Session"}`);
}

function humanize(key: string): string {
  const s = key.replace(/_/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------------------------------------------------------------------------
// Links

function wikilink(target: string, label?: string): string {
  return label && label !== target ? `[[${target}|${label}]]` : `[[${target}]]`;
}

const REF_RE = /@\[([^\]]+)\]\(([0-9a-fA-F-]{36})\)/g;

/** `@[Name](uuid)` → `[[Note|Name]]` when we have that entity, plain name otherwise. */
export function convertRefs(text: string, links: LinkMap): string {
  return text.replace(REF_RE, (_m, name: string, id: string) => {
    const e = links.entities.get(id);
    return e ? wikilink(e.link, name) : name;
  });
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Link the first mention of each known entity in prose that has no inline refs
 * (the chronicle narrative). Longest names win, so "Goblin Camp" beats "Goblin".
 */
export function autoLink(text: string, links: LinkMap): string {
  const byName = new Map<string, string>(); // name → link target
  for (const e of links.entities.values()) {
    if (e.name.length >= 3 && !byName.has(e.name)) byName.set(e.name, e.link);
  }
  if (byName.size === 0) return text;
  const names = [...byName.keys()].sort((a, b) => b.length - a.length);
  const re = new RegExp(`(?<![\\p{L}\\p{N}_])(${names.map(escapeRegExp).join("|")})(?![\\p{L}\\p{N}_])`, "gu");
  const linked = new Set<string>();
  // Existing [[links]] are left untouched; a name already linked there counts as linked.
  return text
    .split(/(\[\[[^\]]*\]\])/)
    .map((seg) => {
      if (seg.startsWith("[[")) {
        const label = seg.slice(2, -2).split("|").pop() as string;
        if (byName.has(label)) linked.add(label);
        return seg;
      }
      return seg.replace(re, (m: string) => {
        if (linked.has(m)) return m;
        linked.add(m);
        return wikilink(byName.get(m) as string, m);
      });
    })
    .join("");
}

// ---------------------------------------------------------------------------
// Frontmatter

type FmValue = string | number | boolean | null | string[];

/** JSON scalars/arrays are valid YAML, which keeps quoting bulletproof. */
export function frontmatter(fields: Record<string, FmValue | undefined>): string {
  const lines = ["---"];
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    lines.push(`${k}: ${JSON.stringify(v)}`);
  }
  lines.push("---");
  return lines.join("\n");
}

/** Keep everything the user wrote after the marker line in an existing note. */
export function mergeUserNotes(generated: string, existing: string | null): string {
  let tail = "\n";
  if (existing) {
    const idx = existing.indexOf(MARKER_PREFIX);
    if (idx >= 0) {
      const lineEnd = existing.indexOf("\n", idx);
      tail = lineEnd >= 0 ? existing.slice(lineEnd) : "\n";
    }
  }
  return `${generated.trimEnd()}\n\n${USER_NOTES_MARKER}${tail}`;
}

/** Kazkar serves avatars as site-relative paths. */
function absoluteUrl(path: string, baseUrl: string): string {
  if (/^https?:\/\//.test(path)) return path;
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function inlineValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map(inlineValue).join(", ");
  return JSON.stringify(v);
}

// ---------------------------------------------------------------------------
// Notes

export function renderSession(recap: SessionRecap, campaign: Campaign, links: LinkMap): string {
  const title = recap.title ?? `Session ${sessionDate(recap.started_at)}`;
  const parts: string[] = [
    frontmatter({
      kazkar_id: recap.id,
      kazkar_kind: "session",
      campaign: wikilink(links.campaign, campaign.name),
      date: sessionDate(recap.started_at),
      duration_minutes: recap.duration_minutes ?? undefined,
      tags: ["kazkar", "kazkar/session"],
    }),
  ];

  // No H1: the file name is the title and Obsidian shows it inline.
  const meta = [`**${title}**`, `Campaign: ${wikilink(links.campaign, campaign.name)}`, `Played ${sessionDate(recap.started_at)}`];
  if (recap.duration_minutes) meta.push(`${recap.duration_minutes} min`);
  parts.push(meta.join(" · "));

  if (recap.highlights?.length) {
    parts.push(
      ["> [!summary] Highlights", ...recap.highlights.map((h) => `> - ${convertRefs(h, links)}`)].join("\n")
    );
  }

  if (recap.narrative) {
    parts.push("## Chronicle", autoLink(convertRefs(recap.narrative, links), links));
  }

  if (recap.epilogue) parts.push("## Epilogue", convertRefs(recap.epilogue, links));

  const bs: BulletSummary = recap.bullet_summary ?? {};
  for (const [key, items] of Object.entries(bs)) {
    if (!Array.isArray(items)) continue;
    // Upstream sometimes emits placeholder entries like "[]" for an empty list.
    const real = items.filter((i) => typeof i === "string" && i.trim() !== "" && i.trim() !== "[]");
    if (real.length === 0) continue;
    const list = real.map((i) => (key === "action_items" ? `- [ ] ${convertRefs(i, links)}` : `- ${convertRefs(i, links)}`));
    parts.push(`## ${humanize(key)}`, list.join("\n"));
  }

  return parts.join("\n\n");
}

function relationLabel(type: string): string {
  return type.replace(/_/g, " ");
}

export function renderEntity(entity: LoreEntityDetail, campaign: Campaign, links: LinkMap, baseUrl: string): string {
  const props = { ...(entity.properties ?? {}) } as Record<string, unknown>;
  const image = typeof props.image_url === "string" ? props.image_url : null;
  delete props.image_url;

  const parts: string[] = [
    frontmatter({
      kazkar_id: entity.id,
      kazkar_kind: "lore",
      entity_type: entity.entity_type,
      campaign: wikilink(links.campaign, campaign.name),
      status: entity.status ?? undefined,
      aliases: (entity.aliases ?? []).filter((a) => a && a !== entity.name),
      tags: ["kazkar", `kazkar/${entity.entity_type.toLowerCase().replace(/[^\p{L}\p{N}_-]+/gu, "-")}`],
      updated: entity.updated_at,
    }),
  ];

  if (image) parts.push(`![${entity.name}|200](${absoluteUrl(image, baseUrl)})`);

  const info: string[] = [`> [!info] ${humanize(entity.entity_type)}${entity.status ? ` · ${entity.status}` : ""}`];
  for (const [k, v] of Object.entries(props)) {
    const val = inlineValue(v);
    if (val) info.push(`> **${humanize(k)}:** ${val}`);
  }
  parts.push(info.join("\n"));

  if (entity.description) parts.push(convertRefs(entity.description, links));

  const rels = entity.relations ?? [];
  if (rels.length) {
    const lines = rels.map((r) => {
      const outgoing = r.source_entity_id === entity.id;
      const otherId = outgoing ? r.target_entity_id : r.source_entity_id;
      const other = links.entities.get(otherId);
      const otherText = other ? wikilink(other.link, other.name) : "(unknown)";
      const head = outgoing
        ? `**${relationLabel(r.relation_type)}** ${otherText}`
        : `${otherText} **${relationLabel(r.relation_type)}** ${entity.name}`;
      return r.description ? `- ${head} — ${convertRefs(r.description, links)}` : `- ${head}`;
    });
    parts.push("## Relations", lines.join("\n"));
  }

  const timeline = entity.timeline ?? [];
  if (timeline.length) {
    const lines = timeline.map((t) => {
      const s = t.session_id ? links.sessions.get(t.session_id) : undefined;
      const when = s ? wikilink(s.link, s.label) : sessionDate(t.created_at);
      return `- ${when}: ${convertRefs(t.update_text, links)}`;
    });
    parts.push("## Timeline", lines.join("\n"));
  }

  return parts.join("\n\n");
}

export function renderCampaignIndex(
  campaign: Campaign,
  sessions: SessionListItem[],
  entities: LoreEntity[],
  links: LinkMap
): string {
  const parts: string[] = [
    frontmatter({
      kazkar_id: campaign.id,
      kazkar_kind: "campaign",
      system: campaign.system ?? undefined,
      gm: campaign.author ?? undefined,
      tags: ["kazkar", "kazkar/campaign"],
    }),
    `# ${campaign.name}`,
  ];
  const meta: string[] = [];
  if (campaign.system) meta.push(campaign.system);
  if (campaign.author) meta.push(`GM: ${campaign.author}`);
  if (meta.length) parts.push(meta.join(" · "));
  if (campaign.description) parts.push(campaign.description);

  const sessionLines = sessions
    .map((s) => links.sessions.get(s.id))
    .filter((s): s is { link: string; label: string } => !!s)
    .map((s) => `- ${wikilink(s.link, s.label)}`);
  if (sessionLines.length) parts.push("## Sessions", sessionLines.join("\n"));

  const byType = new Map<string, string[]>();
  for (const e of entities) {
    const l = links.entities.get(e.id);
    if (!l) continue;
    const key = typeFolder(e.entity_type);
    if (!byType.has(key)) byType.set(key, []);
    byType.get(key)!.push(`- ${wikilink(l.link, l.name)}`);
  }
  for (const [folder, lines] of [...byType.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    parts.push(`## ${folder}`, lines.join("\n"));
  }

  parts.push(
    `---\n*Recaps and lore by [Kazkar](${SITE_URL}/?${UTM}), the AI session chronicler for tabletop RPGs.*`
  );
  return parts.join("\n\n");
}
