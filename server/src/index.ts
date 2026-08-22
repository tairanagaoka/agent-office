import "dotenv/config";
import { randomBytes, randomUUID } from "node:crypto";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE, type SSEStreamingApi } from "hono/streaming";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { loadAgents } from "./agents.js";
import { addTodo, deleteTodo, listTodos, updateTodo } from "./todos.js";

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
const agents = loadAgents();
// `${sessionId}:${agentId}` -> taskId。1部署につき同時に1タスクまで（二重起動防止）
const runningTasks = new Map<string, string>();

// M6ダッシュボード用の集計（プロセス起動からの累計。永続化はしない）
type AgentStats = {
  totalCostUsd: number;
  totalTokens: number;
  totalWaitMs: number;
  tasksCompleted: number;
  tasksFailed: number;
};
const stats = new Map<string, AgentStats>();

function recordResult(agentId: string, message: { is_error?: boolean; total_cost_usd?: number; duration_api_ms?: number; usage?: { input_tokens?: number; output_tokens?: number } }) {
  const s = stats.get(agentId) ?? { totalCostUsd: 0, totalTokens: 0, totalWaitMs: 0, tasksCompleted: 0, tasksFailed: 0 };
  s.totalCostUsd += message.total_cost_usd ?? 0;
  s.totalTokens += (message.usage?.input_tokens ?? 0) + (message.usage?.output_tokens ?? 0);
  s.totalWaitMs += message.duration_api_ms ?? 0;
  if (message.is_error) s.tasksFailed += 1;
  else s.tasksCompleted += 1;
  stats.set(agentId, s);
}

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

app.get("/agents", (c) => {
  return c.json(Array.from(agents.values()).map(({ id, name }) => ({ id, name })));
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

// /chat と Todoの「AIに振る」の両方から使う共通のタスク実行処理。
// todoIdを渡すと、完了・失敗時にそのTodoの状態を更新・永続化する。
// 戻り値: 起動できればtaskId、その部署が既に稼働中ならnull（二重起動防止）
function runTask(
  stream: SSEStreamingApi,
  sessionId: string,
  agentId: string,
  prompt: string,
  todoId?: string
): string | null {
  const agent = agents.get(agentId);
  if (!agent) return null;

  const key = `${sessionId}:${agentId}`;
  if (runningTasks.has(key)) return null;

  const taskId = randomUUID();
  runningTasks.set(key, taskId);

  (async () => {
    let failed = false;
    try {
      for await (const message of query({
        prompt,
        options: {
          allowedTools: ["Read"],
          permissionMode: "default",
          systemPrompt: agent.systemPrompt,
        },
      })) {
        if (message.type === "result") {
          failed = "is_error" in message && !!message.is_error;
          recordResult(agentId, message);
        }
        await stream.writeSSE({ event: "message", data: JSON.stringify({ taskId, agentId, todoId, message }) });
      }
    } catch {
      failed = true;
      recordResult(agentId, { is_error: true });
      await stream.writeSSE({
        event: "message",
        data: JSON.stringify({
          taskId,
          agentId,
          todoId,
          message: { type: "result", subtype: "error", is_error: true },
        }),
      });
    } finally {
      runningTasks.delete(key);
      if (todoId) {
        updateTodo(todoId, { status: failed ? "failed" : "completed", done: !failed });
      }
    }
  })();

  return taskId;
}

app.post("/chat", async (c) => {
  const { sessionId, prompt, agentId } = await c.req.json<{
    sessionId: string;
    prompt: string;
    agentId: string;
  }>();
  const stream = sessions.get(sessionId);
  if (!stream) {
    return c.text("Unknown session", 400);
  }
  if (!agents.has(agentId)) {
    return c.text("Unknown agent", 400);
  }

  const taskId = runTask(stream, sessionId, agentId, prompt);
  if (!taskId) {
    return c.text("Agent is busy", 409);
  }

  return c.json({ ok: true, taskId });
});

app.get("/dashboard", (c) => {
  const runningAgentIds = new Set(Array.from(runningTasks.keys()).map((key) => key.split(":")[1]));
  const perAgent = Array.from(agents.values()).map(({ id, name }) => {
    const s = stats.get(id) ?? { totalCostUsd: 0, totalTokens: 0, totalWaitMs: 0, tasksCompleted: 0, tasksFailed: 0 };
    return { agentId: id, name, running: runningAgentIds.has(id), ...s };
  });
  const overall = perAgent.reduce(
    (acc, a) => ({
      totalCostUsd: acc.totalCostUsd + a.totalCostUsd,
      totalTokens: acc.totalTokens + a.totalTokens,
      totalWaitMs: acc.totalWaitMs + a.totalWaitMs,
      tasksCompleted: acc.tasksCompleted + a.tasksCompleted,
      tasksFailed: acc.tasksFailed + a.tasksFailed,
      runningCount: acc.runningCount + (a.running ? 1 : 0),
    }),
    { totalCostUsd: 0, totalTokens: 0, totalWaitMs: 0, tasksCompleted: 0, tasksFailed: 0, runningCount: 0 }
  );
  return c.json({ overall, perAgent });
});

app.get("/todos", (c) => {
  return c.json(listTodos());
});

app.post("/todos", async (c) => {
  const { text } = await c.req.json<{ text: string }>();
  return c.json(addTodo(text));
});

app.patch("/todos/:id", async (c) => {
  const patch = await c.req.json<{ done?: boolean }>();
  const todo = updateTodo(c.req.param("id"), patch);
  if (!todo) return c.text("Unknown todo", 404);
  return c.json(todo);
});

app.delete("/todos/:id", (c) => {
  deleteTodo(c.req.param("id"));
  return c.json({ ok: true });
});

app.post("/todos/:id/assign", async (c) => {
  const todoId = c.req.param("id");
  const { sessionId, agentId } = await c.req.json<{ sessionId: string; agentId: string }>();
  const stream = sessions.get(sessionId);
  if (!stream) return c.text("Unknown session", 400);
  if (!agents.has(agentId)) return c.text("Unknown agent", 400);

  const todo = updateTodo(todoId, { agentId, status: "running" });
  if (!todo) return c.text("Unknown todo", 404);

  const taskId = runTask(stream, sessionId, agentId, todo.text, todoId);
  if (!taskId) {
    updateTodo(todoId, { status: undefined, agentId: undefined });
    return c.text("Agent is busy", 409);
  }

  return c.json({ ok: true, taskId });
});

serve({ fetch: app.fetch, port: PORT, hostname: "127.0.0.1" }, (info) => {
  console.log(`[agent-office] listening on http://127.0.0.1:${info.port}`);
});
