import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const AGENTS_DIR = join(__dirname, "..", "..", "templates", "agents");

export type AgentDef = {
  id: string;
  name: string;
  systemPrompt: string;
};

// Markdownのfrontmatter（--- id: ... / name: ... ---）を簡易パースする
function parseAgentFile(raw: string, fallbackId: string): AgentDef {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    return { id: fallbackId, name: fallbackId, systemPrompt: raw.trim() };
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
