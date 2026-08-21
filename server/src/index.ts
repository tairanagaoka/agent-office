import "dotenv/config";
import { randomBytes, randomUUID } from "node:crypto";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE, type SSEStreamingApi } from "hono/streaming";
import { query } from "@anthropic-ai/claude-agent-sdk";

const PORT = 3001;
const DEV_ORIGIN = "http://localhost:5173";

// M1時点のセキュリティ要件（8章）: localhost固定 + Origin検証 + 秘密トークン
// トークンは.envに固定値として持たせ、再起動のたびに変わらないようにする（毎回貼り直す手間を無くすため）
const AUTH_TOKEN = process.env.AGENT_OFFICE_TOKEN ?? randomBytes(24).toString("hex");
if (!process.env.AGENT_OFFICE_TOKEN) {
  console.log(
    `\n[agent-office] AGENT_OFFICE_TOKEN が.envに未設定のため、一時トークンを生成しました:\n${AUTH_TOKEN}\n次回以降も固定したい場合は .env に AGENT_OFFICE_TOKEN=${AUTH_TOKEN} を追加してください。\n`
  );
}

const sessions = new Map<string, SSEStreamingApi>();

const app = new Hono();

app.use(
  "*",
  cors({
    origin: DEV_ORIGIN,
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "x-agent-office-token"],
  })
);

app.use("*", async (c, next) => {
  const origin = c.req.header("origin");
  if (origin && origin !== DEV_ORIGIN) {
    return c.text("Forbidden", 403);
  }
  // EventSource はカスタムヘッダーを送れないため、/stream 用にクエリパラメータも許可する
  const token = c.req.header("x-agent-office-token") ?? c.req.query("token");
  if (token !== AUTH_TOKEN) {
    return c.text("Unauthorized", 401);
  }
  await next();
});

app.get("/stream", (c) => {
  return streamSSE(c, async (stream) => {
    const sessionId = randomUUID();
    sessions.set(sessionId, stream);
    await stream.writeSSE({ event: "session", data: sessionId });

    await new Promise<void>((resolve) => {
      stream.onAbort(() => {
        sessions.delete(sessionId);
        resolve();
      });
    });
  });
});

app.post("/chat", async (c) => {
  const { sessionId, prompt } = await c.req.json<{ sessionId: string; prompt: string }>();
  const stream = sessions.get(sessionId);
  if (!stream) {
    return c.text("Unknown session", 400);
  }

  (async () => {
    for await (const message of query({
      prompt,
      options: {
        allowedTools: ["Read"],
        permissionMode: "default",
      },
    })) {
      await stream.writeSSE({ event: "message", data: JSON.stringify(message) });
    }
  })();

  return c.json({ ok: true });
});

serve({ fetch: app.fetch, port: PORT, hostname: "127.0.0.1" }, (info) => {
  console.log(`[agent-office] listening on http://127.0.0.1:${info.port}`);
});
