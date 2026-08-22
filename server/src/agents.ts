import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const AGENTS_DIR = join(__dirname, "..", "..", "templates", "agents");

export type AgentDef = {
  id: string;
  name: string;
  systemPrompt: string;
  allowedTools: string[];
};

// 未指定時の既定値。8章の方針(生活サポート・家計はRead/WebSearchのみ)に合わせ、安全側に倒す
const DEFAULT_TOOLS = ["Read", "WebSearch"];

// Markdownのfrontmatter（--- id: ... / name: ... / tools: ... ---）を簡易パースする。
// Windows(core.autocrlf=true)ではgit checkout時にCRLFへ変換されうるため、
// 改行コードを先に正規化してから判定する（そうしないと正規表現がマッチせず、
// 全エージェントが黙ってデフォルト権限にフォールバックしてしまう）。
function parseAgentFile(rawInput: string, fallbackId: string): AgentDef {
  const raw = rawInput.replace(/\r\n/g, "\n");
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    return { id: fallbackId, name: fallbackId, systemPrompt: raw.trim(), allowedTools: DEFAULT_TOOLS };
  }
  const [, frontmatter, body] = match;
  const data: Record<string, string> = {};
  for (const line of frontmatter.split("\n")) {
    const i = line.indexOf(":");
    if (i === -1) continue;
    data[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return {
    id: data.id ?? fallbackId,
    name: data.name ?? fallbackId,
    systemPrompt: body.trim(),
    allowedTools: data.tools ? data.tools.split(",").map((t) => t.trim()) : DEFAULT_TOOLS,
  };
}

export function loadAgents(): Map<string, AgentDef> {
  const agents = new Map<string, AgentDef>();
  for (const file of readdirSync(AGENTS_DIR)) {
    if (!file.endsWith(".md")) continue;
    const raw = readFileSync(join(AGENTS_DIR, file), "utf-8");
    const agent = parseAgentFile(raw, file.replace(/\.md$/, ""));
    agents.set(agent.id, agent);
  }
  return agents;
}
