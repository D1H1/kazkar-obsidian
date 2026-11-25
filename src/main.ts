import {
  App,
  FuzzySuggestModal,
  normalizePath,
  Notice,
  Plugin,
  PluginSettingTab,
  requestUrl,
  Setting,
  TFile,
  TFolder,
} from "obsidian";
import { HttpPost, KazkarAuthError, KazkarClient } from "./client";
import { SITE_URL } from "./render";
import { syncCampaign, SyncStats, VaultAdapter } from "./sync";
import type { Campaign } from "./types";

const SECRET_ID = "kazkar-api-key";
const CONNECTIONS_URL = `${SITE_URL}/dashboard/connections?utm_source=obsidian&utm_medium=plugin&utm_campaign=obsidian_plugin`;

interface KazkarSettings {
  serverUrl: string;
  folder: string;
  includeLore: boolean;
  syncOnStartup: boolean;
  /** Campaign ids to skip in "Sync all". */
  excludedCampaigns: string[];
}

const DEFAULT_SETTINGS: KazkarSettings = {
  serverUrl: SITE_URL,
  folder: "Kazkar",
  includeLore: true,
  syncOnStartup: false,
  excludedCampaigns: [],
};

const obsidianPost: HttpPost = async (url, headers, body) => {
  const res = await requestUrl({ url, method: "POST", headers, body, throw: false });
  return { status: res.status, text: res.text };
};

class ObsidianVault implements VaultAdapter {
  constructor(private app: App) {}

  indexByKazkarId(): Map<string, string> {
    const map = new Map<string, string>();
    for (const file of this.app.vault.getMarkdownFiles()) {
      const fm: Record<string, unknown> | undefined = this.app.metadataCache.getFileCache(file)?.frontmatter;
      const id = fm?.kazkar_id;
      if (typeof id === "string") map.set(id, file.path);
    }
    return map;
  }

  exists(path: string): boolean {
    return this.app.vault.getAbstractFileByPath(normalizePath(path)) !== null;
  }

  async read(path: string): Promise<string | null> {
    const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
    return file instanceof TFile ? this.app.vault.read(file) : null;
  }

  async write(path: string, content: string): Promise<void> {
    const p = normalizePath(path);
    const file = this.app.vault.getAbstractFileByPath(p);
    if (file instanceof TFile) {
      await this.app.vault.process(file, () => content);
      return;
    }
    const dir = p.split("/").slice(0, -1).join("/");
    if (dir) await this.ensureFolder(dir);
    await this.app.vault.create(p, content);
  }

  private async ensureFolder(dir: string): Promise<void> {
    let cur = "";
    for (const part of dir.split("/")) {
      cur = cur ? `${cur}/${part}` : part;
      const existing = this.app.vault.getAbstractFileByPath(cur);
      if (existing instanceof TFolder) continue;
      if (existing) throw new Error(`${cur} exists and is not a folder`);
      await this.app.vault.createFolder(cur);
    }
  }
}

export default class KazkarPlugin extends Plugin {
  settings: KazkarSettings = DEFAULT_SETTINGS;
  private syncing = false;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.addRibbonIcon("scroll-text", "Sync Kazkar campaigns", () => {
      void this.syncAll();
    });

    this.addCommand({
      id: "sync-all",
      name: "Sync all campaigns",
      callback: () => void this.syncAll(),
    });

    this.addCommand({
      id: "sync-campaign",
      name: "Sync one campaign…",
      callback: () => void this.pickAndSync(),
    });

    this.addCommand({
      id: "open-dashboard",
      name: "Open dashboard in browser",
      callback: () => window.open(`${this.settings.serverUrl}/dashboard`),
    });

    this.addSettingTab(new KazkarSettingTab(this.app, this));

    if (this.settings.syncOnStartup && this.getApiKey()) {
      this.app.workspace.onLayoutReady(() => void this.syncAll(true));
    }
  }

  async loadSettings(): Promise<void> {
    const saved = (await this.loadData()) as Partial<KazkarSettings> | null;
    this.settings = { ...DEFAULT_SETTINGS, ...(saved ?? {}) };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  getApiKey(): string {
    return this.app.secretStorage.getSecret(SECRET_ID) ?? "";
  }

  setApiKey(key: string): void {
    this.app.secretStorage.setSecret(SECRET_ID, key.trim());
  }

  client(): KazkarClient | null {
    const key = this.getApiKey();
    if (!key) {
      new Notice("Add your Kazkar API key in Settings → Kazkar first.");
      return null;
    }
    return new KazkarClient(this.settings.serverUrl, key, obsidianPost);
  }

  private async pickAndSync(): Promise<void> {
    const client = this.client();
    if (!client) return;
    try {
      const campaigns = await client.listCampaigns();
      if (campaigns.length === 0) {
        new Notice("No campaigns on this Kazkar account yet.");
        return;
      }
      new CampaignPicker(this.app, campaigns, (c) => void this.runSync([c])).open();
    } catch (e) {
      this.reportError(e);
    }
  }

  async syncAll(quiet = false): Promise<void> {
    const client = this.client();
    if (!client) return;
    try {
      const campaigns = (await client.listCampaigns()).filter(
        (c) => !this.settings.excludedCampaigns.includes(c.id)
      );
      await this.runSync(campaigns, quiet);
    } catch (e) {
      this.reportError(e);
    }
  }

  private async runSync(campaigns: Campaign[], quiet = false): Promise<void> {
    const client = this.client();
    if (!client) return;
    if (this.syncing) {
      new Notice("A Kazkar sync is already running.");
      return;
    }
    this.syncing = true;
    const notice = quiet ? null : new Notice("Kazkar: starting sync…", 0);
    const stats: SyncStats = { created: 0, updated: 0, unchanged: 0 };
    const vault = new ObsidianVault(this.app);
    try {
      for (const c of campaigns) {
        await syncCampaign(client, vault, c, {
          rootFolder: normalizePath(this.settings.folder || DEFAULT_SETTINGS.folder),
          baseUrl: this.settings.serverUrl,
          includeLore: this.settings.includeLore,
          onProgress: (msg) => notice?.setMessage(`Kazkar: ${msg}`),
        }, stats);
      }
      notice?.hide();
      if (!quiet || stats.created + stats.updated > 0) {
        new Notice(
          `Kazkar: synced ${campaigns.length} campaign(s). ${stats.created} new, ${stats.updated} updated, ${stats.unchanged} unchanged.`
        );
      }
    } catch (e) {
      notice?.hide();
      this.reportError(e);
    } finally {
      this.syncing = false;
    }
  }

  private reportError(e: unknown): void {
    console.error("[kazkar]", e);
    const msg = e instanceof Error ? e.message : String(e);
    new Notice(e instanceof KazkarAuthError ? msg : `Kazkar sync failed: ${msg}`, 8000);
  }
}

class CampaignPicker extends FuzzySuggestModal<Campaign> {
  constructor(app: App, private campaigns: Campaign[], private onPick: (c: Campaign) => void) {
    super(app);
    this.setPlaceholder("Pick a campaign to sync");
  }
  getItems(): Campaign[] {
    return this.campaigns;
  }
  getItemText(c: Campaign): string {
    return c.system ? `${c.name} (${c.system})` : c.name;
  }
  onChooseItem(c: Campaign): void {
    this.onPick(c);
  }
}

class KazkarSettingTab extends PluginSettingTab {
  private campaigns: Campaign[] | null = null;

  constructor(app: App, private plugin: KazkarPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    const intro = containerEl.createEl("p");
    intro.appendText("Kazkar records your tabletop RPG sessions and writes the recaps and lore wiki. Get an API key from ");
    intro.createEl("a", { text: "Kazkar → Dashboard → Connections", href: CONNECTIONS_URL });
    intro.appendText(" (read-only is enough).");

    new Setting(containerEl)
      .setName("API key")
      .setDesc("Stored in Obsidian's secret storage, not in the plugin's data file.")
      .addText((text) => {
        text.inputEl.type = "password";
        text
          .setPlaceholder("kzk_mcp_…")
          .setValue(this.plugin.getApiKey())
          .onChange((value) => this.plugin.setApiKey(value));
      })
      .addButton((btn) =>
        btn.setButtonText("Test connection").onClick(async () => {
          const client = this.plugin.client();
          if (!client) return;
          try {
            this.campaigns = await client.listCampaigns();
            new Notice(`Connected. ${this.campaigns.length} campaign(s) found.`);
            this.display();
          } catch (e) {
            new Notice(e instanceof Error ? e.message : String(e), 8000);
          }
        })
      );

    new Setting(containerEl)
      .setName("Folder")
      .setDesc("Vault folder for synced campaigns. Each campaign gets its own subfolder.")
      .addText((text) =>
        text.setValue(this.plugin.settings.folder).onChange(async (value) => {
          this.plugin.settings.folder = value.trim() || DEFAULT_SETTINGS.folder;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Sync lore wiki")
      .setDesc("Create a note for every NPC, location, item and faction, linked from the recaps.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.includeLore).onChange(async (v) => {
          this.plugin.settings.includeLore = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Sync on startup")
      .setDesc("Pull new recaps and lore each time the vault opens.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.syncOnStartup).onChange(async (v) => {
          this.plugin.settings.syncOnStartup = v;
          await this.plugin.saveSettings();
        })
      );

    if (this.campaigns?.length) {
      new Setting(containerEl).setName("Campaigns").setHeading();
      for (const c of this.campaigns) {
        new Setting(containerEl)
          .setName(c.name)
          .setDesc(`${c.role === "owner" ? "You're the GM" : `Player · GM: ${c.author ?? "unknown"}`}${c.system ? ` · ${c.system}` : ""}`)
          .addToggle((t) =>
            t.setValue(!this.plugin.settings.excludedCampaigns.includes(c.id)).onChange(async (on) => {
              const set = new Set(this.plugin.settings.excludedCampaigns);
              if (on) set.delete(c.id);
              else set.add(c.id);
              this.plugin.settings.excludedCampaigns = [...set];
              await this.plugin.saveSettings();
            })
          );
      }
    }

    new Setting(containerEl).setName("Advanced").setHeading();
    new Setting(containerEl)
      .setName("Server URL")
      .setDesc("Leave as is unless you were told otherwise.")
      .addText((text) =>
        text.setValue(this.plugin.settings.serverUrl).onChange(async (value) => {
          this.plugin.settings.serverUrl = value.trim().replace(/\/+$/, "") || SITE_URL;
          await this.plugin.saveSettings();
        })
      );
  }
}
