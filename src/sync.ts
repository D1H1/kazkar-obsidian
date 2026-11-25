// Sync orchestration: fetch a campaign from Kazkar, plan vault paths, write notes.
// Vault access goes through VaultAdapter so this runs in tests without Obsidian.

import type { KazkarClient } from "./client";
import {
  LinkMap,
  mergeUserNotes,
  renderCampaignIndex,
  renderEntity,
  renderSession,
  sanitizeFileName,
  sessionBaseName,
  typeFolder,
} from "./render";
import type { Campaign, LoreEntityDetail, SessionRecap } from "./types";

export interface VaultAdapter {
  /** kazkar_id (from frontmatter) → vault path, for notes the user may have moved or renamed. */
  indexByKazkarId(): Map<string, string>;
  exists(path: string): boolean;
  read(path: string): Promise<string | null>;
  /** Create or overwrite, creating parent folders as needed. */
  write(path: string, content: string): Promise<void>;
}

export interface SyncOptions {
  rootFolder: string;
  baseUrl: string;
  includeLore: boolean;
  onProgress?: (msg: string) => void;
}

export interface SyncStats {
  created: number;
  updated: number;
  unchanged: number;
}

/** Run fn over items with at most `limit` in flight. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

function joinPath(...parts: string[]): string {
  return parts
    .map((p) => p.replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .join("/");
}

/** Link target for a vault path: full path without .md, so same-named notes in two campaigns never collide. */
function linkTarget(path: string): string {
  return path.replace(/\.md$/, "");
}

class PathPlanner {
  private taken = new Set<string>();
  constructor(private vault: VaultAdapter, private index: Map<string, string>) {}

  /** Reuse the note's current location if it has one; otherwise find a free path in `folder`. */
  plan(kazkarId: string, folder: string, baseName: string): string {
    const existing = this.index.get(kazkarId);
    if (existing && !this.taken.has(existing.toLowerCase())) {
      this.taken.add(existing.toLowerCase());
      return existing;
    }
    for (let n = 1; n < 1000; n++) {
      const name = n === 1 ? baseName : `${baseName} (${n})`;
      const path = joinPath(folder, `${name}.md`);
      const key = path.toLowerCase();
      // A file we don't own (no matching kazkar_id) is the user's: never overwrite it.
      if (this.taken.has(key) || this.vault.exists(path)) continue;
      this.taken.add(key);
      return path;
    }
    throw new Error(`No free file name for ${baseName}`);
  }
}

async function writeNote(vault: VaultAdapter, path: string, generated: string, stats: SyncStats): Promise<void> {
  const existing = await vault.read(path);
  const content = mergeUserNotes(generated, existing);
  if (existing === content) {
    stats.unchanged++;
    return;
  }
  await vault.write(path, content);
  if (existing === null) stats.created++;
  else stats.updated++;
}

export async function syncCampaign(
  client: KazkarClient,
  vault: VaultAdapter,
  campaign: Campaign,
  opts: SyncOptions,
  stats: SyncStats = { created: 0, updated: 0, unchanged: 0 }
): Promise<SyncStats> {
  const progress = opts.onProgress ?? (() => undefined);
  const root = joinPath(opts.rootFolder, sanitizeFileName(campaign.name));
  const planner = new PathPlanner(vault, vault.indexByKazkarId());

  progress(`${campaign.name}: listing sessions and lore…`);
  const [allSessions, entities] = await Promise.all([
    client.listSessions(campaign.id),
    opts.includeLore ? client.listLoreEntities(campaign.id) : Promise.resolve([]),
  ]);
  // Only sessions with a finished chronicle; failed or in-progress ones have nothing to show.
  const sessions = allSessions.filter((s) => s.recap_title);

  const campaignPath = planner.plan(campaign.id, root, sanitizeFileName(campaign.name));
  const links: LinkMap = { campaign: linkTarget(campaignPath), entities: new Map(), sessions: new Map() };

  const sessionPaths = new Map<string, string>();
  for (const s of sessions) {
    const path = planner.plan(s.id, joinPath(root, "Sessions"), sessionBaseName(s));
    sessionPaths.set(s.id, path);
    links.sessions.set(s.id, { link: linkTarget(path), label: sessionBaseName(s) });
  }

  const entityPaths = new Map<string, string>();
  for (const e of entities) {
    const path = planner.plan(e.id, joinPath(root, "Lore", typeFolder(e.entity_type)), sanitizeFileName(e.name));
    entityPaths.set(e.id, path);
    links.entities.set(e.id, { link: linkTarget(path), name: e.name, type: e.entity_type });
  }

  let done = 0;
  const total = sessions.length + entities.length;
  const tick = () => progress(`${campaign.name}: ${++done}/${total}`);

  const recaps = await mapLimit(sessions, 4, async (s) => {
    const r = await client.getSessionRecap(s.id);
    tick();
    return r;
  });
  const details = await mapLimit(entities, 6, async (e) => {
    const d = await client.getLoreEntity(e.id);
    tick();
    return d;
  });

  for (const recap of recaps.filter((r): r is SessionRecap => !!r)) {
    await writeNote(vault, sessionPaths.get(recap.id) as string, renderSession(recap, campaign, links), stats);
  }
  for (const d of details.filter((x): x is LoreEntityDetail => !!x)) {
    await writeNote(vault, entityPaths.get(d.id) as string, renderEntity(d, campaign, links, opts.baseUrl), stats);
  }
  await writeNote(vault, campaignPath, renderCampaignIndex(campaign, sessions, entities, links), stats);

  return stats;
}
