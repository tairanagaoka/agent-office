import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// agent-office自身の設置場所(index.tsと同じ算出方法)。projectのpathとは別物で、
// templates/agents/やserver/data/を探す基準として使う(scope:globalのagentのcwdにもなる)。
const PROJECT_ROOT = join(__dirname, "..", "..");
const DATA_DIR = join(__dirname, "..", "data");
const PROJECTS_FILE = join(DATA_DIR, "projects.json");

export type Project = {
  id: string;
  name: string;
  path: string;
  createdAt: string;
};

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return (base || "project") + "-" + randomBytes(3).toString("hex");
}

function readRaw(): Project[] {
  if (!existsSync(PROJECTS_FILE)) {
    const seeded: Project[] = [
      { id: "self", name: "agent-office(自分)", path: PROJECT_ROOT, createdAt: new Date().toISOString() },
    ];
    writeRaw(seeded);
    return seeded;
  }
  return JSON.parse(readFileSync(PROJECTS_FILE, "utf-8"));
}

function writeRaw(projects: Project[]): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(PROJECTS_FILE, JSON.stringify(projects, null, 2));
}

export function loadProjects(): Project[] {
  return readRaw();
}

export function getProject(id: string): Project | undefined {
  return readRaw().find((p) => p.id === id);
}

// プロジェクト登録はユーザー操作(UIのフォーム)からのみ呼ばれる想定。
// エージェントがこの関数へ到達する経路(MCPツール等)は作らない。
export function registerProject(name: string, rawPath: string): Project {
  const path = resolve(rawPath);
  if (!existsSync(path) || !statSync(path).isDirectory()) {
    throw new Error(`指定されたパスはディレクトリとして存在しません: ${path}`);
  }
  const projects = readRaw();
  let id = slugify(name);
  while (projects.some((p) => p.id === id)) {
    id = slugify(name);
  }
  const project: Project = { id, name, path, createdAt: new Date().toISOString() };
  projects.push(project);
  writeRaw(projects);
  return project;
}
