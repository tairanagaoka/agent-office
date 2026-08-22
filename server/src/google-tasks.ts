import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");
const AUTH_FILE = join(DATA_DIR, "google-auth.json");

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? "";
export const REDIRECT_URI = "http://127.0.0.1:3001/auth/google/callback";
// 取り込みのみ(agent-office側からの書き込みはしない)なのでreadonlyスコープに限定する
const SCOPE = "https://www.googleapis.com/auth/tasks.readonly";

type StoredTokens = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
};

function readTokens(): StoredTokens | null {
  if (!existsSync(AUTH_FILE)) return null;
  return JSON.parse(readFileSync(AUTH_FILE, "utf-8"));
}

function writeTokens(tokens: StoredTokens): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(AUTH_FILE, JSON.stringify(tokens, null, 2));
}

export function isConnected(): boolean {
  return readTokens() !== null;
}

export function buildAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function exchangeCode(code: string): Promise<void> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed: ${await res.text()}`);
  const data = await res.json();
  writeTokens({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
  });
}

async function refreshAccessToken(tokens: StoredTokens): Promise<StoredTokens> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: tokens.refresh_token,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Google token refresh failed: ${await res.text()}`);
  const data = await res.json();
  // リフレッシュのレスポンスには新しいrefresh_tokenは含まれないため、既存のものを使い回す
  const updated: StoredTokens = {
    access_token: data.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
  };
  writeTokens(updated);
  return updated;
}

async function getValidAccessToken(): Promise<string> {
  const tokens = readTokens();
  if (!tokens) throw new Error("Google Tasks is not connected");
  if (Date.now() > tokens.expires_at - 60_000) {
    const refreshed = await refreshAccessToken(tokens);
    return refreshed.access_token;
  }
  return tokens.access_token;
}

export type GoogleTask = { id: string; title: string };

export async function fetchIncompleteTasks(): Promise<GoogleTask[]> {
  const accessToken = await getValidAccessToken();
  const res = await fetch(
    "https://tasks.googleapis.com/tasks/v1/lists/@default/tasks?showCompleted=false&showHidden=false",
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) throw new Error(`Google Tasks fetch failed: ${await res.text()}`);
  const data = await res.json();
  return (data.items ?? []).map((item: { id: string; title: string }) => ({ id: item.id, title: item.title }));
}
