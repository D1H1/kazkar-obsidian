import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { KazkarAuthError, KazkarClient } from "../src/client";
import { syncCampaign } from "../src/sync";
import { USER_NOTES_MARKER } from "../src/render";
import { campaign, E_MIRA } from "./fixtures";
import { fetchPost, MemoryVault } from "./helpers";
import { GOOD_KEY, startMockServer } from "./mock-server";

let srv: Awaited<ReturnType<typeof startMockServer>>;
beforeAll(async () => { srv = await startMockServer(); });
afterAll(async () => { await srv.close(); });

const opts = () => ({ rootFolder: "Kazkar", baseUrl: "https://kazkar.ai", includeLore: true });
const ROOT = "Kazkar/The Sunken Bell";

describe("client against a real MCP SDK server", () => {
  it("lists campaigns over SSE", async () => {
    const c = new KazkarClient(srv.url, GOOD_KEY, fetchPost);
    expect((await c.listCampaigns()).map((x) => x.name)).toEqual(["The Sunken Bell"]);
  });

  it("follows pagination cursors", async () => {
    const c = new KazkarClient(srv.url, GOOD_KEY, fetchPost);
    expect(await c.listSessions(campaign.id)).toHaveLength(3);
    expect(await c.listLoreEntities(campaign.id)).toHaveLength(3);
  });

  it("raises an auth error on a bad key", async () => {
    const c = new KazkarClient(srv.url, "kzk_mcp_wrong", fetchPost);
    await expect(c.listCampaigns()).rejects.toBeInstanceOf(KazkarAuthError);
  });
});

describe("syncCampaign", () => {
  it("writes campaign, sessions and lore with resolvable links", async () => {
    const vault = new MemoryVault();
    const c = new KazkarClient(srv.url, GOOD_KEY, fetchPost);
    const stats = await syncCampaign(c, vault, campaign, opts());

    expect([...vault.files.keys()].sort()).toEqual([
      `${ROOT}/Lore/Characters/Mira.md`,
      `${ROOT}/Lore/Items/Storm Lantern.md`,
      `${ROOT}/Lore/Locations/Drowned Hollow.md`,
      `${ROOT}/Sessions/2026-02-24 The Bell Wakes.md`,
      `${ROOT}/Sessions/2026-03-03 Lanterns Over the Hollow.md`,
      `${ROOT}/The Sunken Bell.md`,
    ]);
    expect(stats).toEqual({ created: 6, updated: 0, unchanged: 0 });

    // Every [[link]] target must be a real note.
    const notes = new Set([...vault.files.keys()].map((p) => p.replace(/\.md$/, "")));
    for (const [path, content] of vault.files) {
      for (const m of content.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)) {
        expect(notes.has(m[1]), `${path} links to missing ${m[1]}`).toBe(true);
      }
    }

    const s1 = vault.files.get(`${ROOT}/Sessions/2026-02-24 The Bell Wakes.md`)!;
    expect(s1).toContain('kazkar_id: "22222222-2222-4222-8222-222222222222"');
    expect(s1).toContain("> [!summary] Highlights");
    expect(s1).toContain(`[[${ROOT}/Lore/Characters/Mira|Mira]] waded into [[${ROOT}/Lore/Locations/Drowned Hollow|Drowned Hollow]] at dusk. In Drowned Hollow`);
    expect(s1).toContain("- Found Ghost Ship"); // unknown entity → plain text
    expect(s1).toContain(`- [ ] Return to [[${ROOT}/Lore/Locations/Drowned Hollow|Drowned Hollow]]`);
    expect(s1).not.toContain("Combat highlights");
    expect(s1).not.toContain("Funny moments"); // placeholder "[]" entries dropped

    const mira = vault.files.get(`${ROOT}/Lore/Characters/Mira.md`)!;
    expect(mira).toContain('aliases: ["the diver"]');
    expect(mira).toContain("![Mira|200](https://kazkar.ai/avatars/portraits/001.webp)");
    expect(mira).toContain("> **Languages:** Common, Aquan");
    expect(mira).toContain(`- **owns** [[${ROOT}/Lore/Items/Storm Lantern|Storm Lantern]]`);
    expect(mira).toContain(`- [[${ROOT}/Lore/Locations/Drowned Hollow|Drowned Hollow]] **haunts** Mira — The hollow calls to her.`);
    expect(mira).toContain(`- [[${ROOT}/Sessions/2026-02-24 The Bell Wakes|2026-02-24 The Bell Wakes]]: Heard the bell.`);
    expect(mira).toContain("- 2026-02-25: Added by hand.");

    const index = vault.files.get(`${ROOT}/The Sunken Bell.md`)!;
    expect(index.indexOf("2026-03-03")).toBeLessThan(index.indexOf("2026-02-24")); // newest first
    expect(index).toContain("## Characters");
    expect(index).toContain("utm_source=obsidian");
  });

  it("is idempotent, keeps user notes, follows moved notes, never clobbers user files", async () => {
    const vault = new MemoryVault();
    const c = new KazkarClient(srv.url, GOOD_KEY, fetchPost);

    // A user's own note sits where Storm Lantern would go.
    vault.files.set(`${ROOT}/Lore/Items/Storm Lantern.md`, "my own lantern note");
    await syncCampaign(c, vault, campaign, opts());
    expect(vault.files.get(`${ROOT}/Lore/Items/Storm Lantern.md`)).toBe("my own lantern note");
    expect(vault.files.has(`${ROOT}/Lore/Items/Storm Lantern (2).md`)).toBe(true);

    // User moves Mira and writes notes under the marker.
    const old = `${ROOT}/Lore/Characters/Mira.md`;
    const moved = "Party/Mira the diver.md";
    vault.files.set(moved, vault.files.get(old)! + "Secretly a mermaid.\n");
    vault.files.delete(old);

    vault.writes = 0;
    const stats = await syncCampaign(c, vault, campaign, opts());
    expect(stats.created).toBe(0);
    expect(vault.files.has(old)).toBe(false);
    expect(vault.files.get(moved)).toContain(`${USER_NOTES_MARKER}\nSecretly a mermaid.`);
    // Links now point at the moved note.
    expect(vault.files.get(`${ROOT}/Sessions/2026-02-24 The Bell Wakes.md`)).toContain("[[Party/Mira the diver|Mira]]");
    expect(vault.indexByKazkarId().get(E_MIRA)).toBe(moved);

    // Third run: nothing changes, nothing is written.
    vault.writes = 0;
    const again = await syncCampaign(c, vault, campaign, opts());
    expect(vault.writes).toBe(0);
    expect(again.unchanged).toBe(6);
  });

  it("skips lore when disabled", async () => {
    const vault = new MemoryVault();
    const c = new KazkarClient(srv.url, GOOD_KEY, fetchPost);
    await syncCampaign(c, vault, campaign, { ...opts(), includeLore: false });
    expect([...vault.files.keys()].some((p) => p.includes("/Lore/"))).toBe(false);
  });
});
