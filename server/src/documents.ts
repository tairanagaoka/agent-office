import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = join(__dirname, "..", "data", "documents");

export type DocumentEntry = {
  id: string;
  agentName: string;
  prompt: string;
  text: string;
  timestamp: number;
  projectId: string;
};

function ensureDir(): void {
  if (!existsSync(DOCS_DIR)) mkdirSync(DOCS_DIR, { recursive: true });
}

function toFrontmatter(doc: Omit<DocumentEntry, "text">): string {
  return [
    "---",
    `id: ${doc.id}`,
    `agent: ${doc.agentName}`,
    `prompt: ${JSON.stringify(doc.prompt)}`,
    `timestamp: ${doc.timestamp}`,
    `project: ${doc.projectId}`,
    "---",
    "",
    "",
  ].join("\n");
}

// 構想メモ5-4「書斎（ナレッジ蓄積）」の実体。セッションが消えても資料は
// server/data/documents/ に.mdファイルとして残る。
export function saveDocument(agentName: string, prompt: string, text: string, projectId: string): DocumentEntry {
  ensureDir();
  const id = randomUUID();
  const timestamp = Date.now();
  const doc = { id, agentName, prompt, timestamp, projectId };
  writeFileSync(join(DOCS_DIR, `${timestamp}-${id}.md`), toFrontmatter(doc) + text);
  return { ...doc, text };
}

export function listDocuments(projectId?: string): DocumentEntry[] {
  ensureDir();
  const files = readdirSync(DOCS_DIR).filter((f) => f.endsWith(".md"));
  const docs = files
    .map((file): DocumentEntry | null => {
      const raw = readFileSync(join(DOCS_DIR, file), "utf-8").replace(/\r\n/g, "\n");
      const match = raw.match(/^---\n([\s\S]*?)\n---\n\n?([\s\S]*)$/);
      if (!match) return null;
      const [, frontmatter, body] = match;
      const data: Record<string, string> = {};
      for (const line of frontmatter.split("\n")) {
        const i = line.indexOf(":");
        if (i === -1) continue;
        data[line.slice(0, i).trim()] = line.slice(i + 1).trim();
      }
      let prompt = data.prompt ?? "";
      try {
        prompt = JSON.parse(prompt);
      } catch {
        // 旧形式などでJSONでなければそのまま使う
      }
      return {
        id: data.id ?? file,
        agentName: data.agent ?? "",
        prompt,
        timestamp: Number(data.timestamp) || 0,
        // projectIdが無い古いファイルは、当時実際にagent-office自身のディレクトリで
        // 動いていたので"self"として扱う(後方互換)
        projectId: data.project ?? "self",
        text: body.trim(),
      };
    })
    .filter((d): d is DocumentEntry => d !== null)
    .filter((d) => !projectId || d.projectId === projectId);

  return docs.sort((a, b) => b.timestamp - a.timestamp);
}
