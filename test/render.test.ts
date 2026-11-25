import { describe, expect, it } from "vitest";
import { autoLink, convertRefs, frontmatter, LinkMap, mergeUserNotes, sanitizeFileName, typeFolder, USER_NOTES_MARKER } from "../src/render";
import { parseRpcBody } from "../src/client";

const links: LinkMap = {
  campaign: "Kazkar/Bell/Bell",
  sessions: new Map(),
  entities: new Map([
    ["33333333-3333-4333-8333-111111111111", { link: "Kazkar/Bell/Lore/Characters/Mira", name: "Mira", type: "character" }],
    ["33333333-3333-4333-8333-222222222222", { link: "Kazkar/Bell/Lore/Locations/Goblin Camp", name: "Goblin Camp", type: "location" }],
    ["33333333-3333-4333-8333-333333333333", { link: "Kazkar/Bell/Lore/Characters/Goblin", name: "Goblin", type: "character" }],
  ]),
};

describe("render helpers", () => {
  it("sanitizes forbidden filename characters", () => {
    expect(sanitizeFileName('Lanterns: Over/the "Hollow"? [1] #2 ^x|y')).toBe("Lanterns Over the Hollow 1 2 x y");
    expect(sanitizeFileName("...")).toBe("Untitled");
    expect(sanitizeFileName("Пекс")).toBe("Пекс");
  });

  it("maps entity types to folders", () => {
    expect(typeFolder("character")).toBe("Characters");
    expect(typeFolder("location")).toBe("Locations");
    expect(typeFolder("deity")).toBe("Deitys");
    expect(typeFolder("ships")).toBe("Ships");
  });

  it("converts inline refs to path wikilinks, unknown refs to plain text", () => {
    const out = convertRefs("@[Mira](33333333-3333-4333-8333-111111111111) met @[Bob](44444444-4444-4444-8444-444444444444).", links);
    expect(out).toBe("[[Kazkar/Bell/Lore/Characters/Mira|Mira]] met Bob.");
  });

  it("auto-links first mention only, longest name first, whole words", () => {
    const out = autoLink("Goblin Camp burned. A Goblin fled Goblin Camp. Miraculous Mira.", links);
    expect(out).toBe(
      "[[Kazkar/Bell/Lore/Locations/Goblin Camp|Goblin Camp]] burned. A [[Kazkar/Bell/Lore/Characters/Goblin|Goblin]] fled Goblin Camp. Miraculous [[Kazkar/Bell/Lore/Characters/Mira|Mira]]."
    );
  });

  it("does not double-link text that already has a wikilink", () => {
    const once = convertRefs("@[Mira](33333333-3333-4333-8333-111111111111) and Mira", links);
    expect(autoLink(once, links)).toBe("[[Kazkar/Bell/Lore/Characters/Mira|Mira]] and Mira");
  });

  it("writes YAML-safe frontmatter and drops empties", () => {
    const fm = frontmatter({ a: 'He said: "hi" #tag', b: [], c: null, d: ["x: y"], e: 3 });
    expect(fm).toBe('---\na: "He said: \\"hi\\" #tag"\nd: ["x: y"]\ne: 3\n---');
  });

  it("keeps user notes below the marker across syncs", () => {
    const first = mergeUserNotes("# Gen v1", null);
    expect(first).toBe(`# Gen v1\n\n${USER_NOTES_MARKER}\n`);
    const edited = first + "My theory: Mira is the bell.\n";
    const second = mergeUserNotes("# Gen v2", edited);
    expect(second).toBe(`# Gen v2\n\n${USER_NOTES_MARKER}\nMy theory: Mira is the bell.\n`);
  });
});

describe("parseRpcBody", () => {
  it("parses plain JSON", () => {
    expect(parseRpcBody('{"jsonrpc":"2.0","id":1,"result":{"content":[]}}').result).toEqual({ content: [] });
  });
  it("parses SSE with multiple data lines and skips notifications", () => {
    const sse = 'event: message\ndata: {"jsonrpc":"2.0","method":"notifications/progress"}\n\nevent: message\ndata: {"jsonrpc":"2.0",\ndata: "id":1,"result":{"isError":false}}\n\n';
    expect(parseRpcBody(sse).result).toEqual({ isError: false });
  });
});
