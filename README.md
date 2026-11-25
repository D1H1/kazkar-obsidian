# Kazkar for Obsidian

Pull your tabletop RPG sessions out of [Kazkar](https://kazkar.ai/?utm_source=obsidian&utm_medium=readme&utm_campaign=obsidian_plugin) and into your vault as linked notes: a chronicle for every session, plus a wiki page for every NPC, location, item and faction.

[Kazkar](https://kazkar.ai/?utm_source=obsidian&utm_medium=readme&utm_campaign=obsidian_plugin) is a Discord bot that records D&D and other TTRPG sessions and writes them up for Game Masters and players. This plugin brings that writing into Obsidian, so your campaign notes, your prep and the session record live in one graph.

## What you get

```
Kazkar/
  The Sunken Bell/
    The Sunken Bell.md                       campaign index: sessions + lore by type
    Sessions/
      2026-02-24 The Bell Wakes.md           highlights, chronicle, epilogue, key events, action items
      2026-03-03 Lanterns Over the Hollow.md
    Lore/
      Characters/Mira.md                     description, properties, relations, per-session timeline
      Locations/Drowned Hollow.md
      Items/Storm Lantern.md
```

- **Everything is linked.** NPC and place names in recaps become `[[wikilinks]]`, relations link entity to entity, and each timeline entry links back to the session it happened in. Graph view and backlinks work out of the box.
- **Your notes survive syncs.** Each note ends with a `%% kazkar:end %%` line. Write anything below it and Kazkar will never touch it.
- **Move and rename freely.** Notes are matched by the `kazkar_id` property, so a note you moved into your own folder structure keeps updating in place.
- **Never overwrites your files.** If a note with the same name already exists and wasn't made by Kazkar, the synced note gets a `(2)` suffix instead.
- **Aliases included.** Entity aliases go into the `aliases` property, so Obsidian's link suggestions find "the old innkeeper" too.
- **Action items become tasks** (`- [ ]`), so they show up in task queries.

## Setup

1. Sign in at [kazkar.ai](https://kazkar.ai/?utm_source=obsidian&utm_medium=readme&utm_campaign=obsidian_plugin) with Discord. Every plan works, including Free.
2. Go to **Dashboard → Connections** and create a key. A read-only key is enough.
3. In Obsidian, open **Settings → Kazkar**, paste the key and click **Test connection**.
4. Run **Kazkar: Sync all campaigns** from the command palette, or click the scroll icon in the ribbon.

Optional: turn on **Sync on startup**, switch off campaigns you don't want, or change the target folder.

## Commands

| Command | What it does |
|---|---|
| Sync all campaigns | Syncs every campaign you own or play in (minus any you switched off) |
| Sync one campaign… | Pick a single campaign to sync |
| Open dashboard in browser | Opens your Kazkar dashboard |

## Privacy and network use

- **Account required.** You need a Kazkar account (free plan available) and a personal API key.
- **Network.** The plugin talks to `https://kazkar.ai/api/mcp` only, and only while a sync runs (manually, or at startup if you turn that on). It reads your campaigns, session recaps and lore. It never sends vault content to Kazkar.
- **Key storage.** The key is kept in Obsidian's secret storage (the system keychain), not in the plugin's `data.json`, so it doesn't end up in vault backups or git.
- **Players see what players can see.** The key carries your Kazkar permissions: a player gets the recaps and lore of campaigns they're in, and GM-only transcripts are never synced.
- No telemetry, no ads.

## Development

```bash
npm install
npm test           # unit tests + sync tests against a local MCP server
npm run build      # main.js
npx tsx test/serve-mock.ts   # fake Kazkar server for manual testing in a dev vault
```

Releases: bump `version` in `manifest.json` and `versions.json`, then push a tag with the same version. The workflow attaches `main.js` and `manifest.json`.

## Support

Questions and bugs: open an issue here, or reach us through [kazkar.ai](https://kazkar.ai/?utm_source=obsidian&utm_medium=readme&utm_campaign=obsidian_plugin).
