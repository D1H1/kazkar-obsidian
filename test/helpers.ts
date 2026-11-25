import type { HttpPost } from "../src/client";
import type { VaultAdapter } from "../src/sync";

export const fetchPost: HttpPost = async (url, headers, body) => {
  const res = await fetch(url, { method: "POST", headers, body });
  return { status: res.status, text: await res.text() };
};

/** In-memory vault; indexes kazkar_id from frontmatter like Obsidian's metadata cache. */
export class MemoryVault implements VaultAdapter {
  files = new Map<string, string>();
  writes = 0;
  indexByKazkarId() {
    const m = new Map<string, string>();
    for (const [path, content] of this.files) {
      const id = content.match(/^---\n[\s\S]*?^kazkar_id: "([^"]+)"/m)?.[1];
      if (id) m.set(id, path);
    }
    return m;
  }
  exists(path: string) { return this.files.has(path); }
  async read(path: string) { return this.files.get(path) ?? null; }
  async write(path: string, content: string) { this.writes++; this.files.set(path, content); }
}
