import { useEffect, useRef, useState } from "react";

const SERVER_URL = "http://127.0.0.1:3001";
const TOKEN_STORAGE_KEY = "agent-office-token";

type ChatLine = {
  role: string;
  text: string;
};

type Agent = {
  id: string;
  name: string;
};

type PanelState = {
  name: string;
  lines: ChatLine[];
  status: "idle" | "running" | "failed";
  prompt: string;
};

type Todo = {
  id: string;
  text: string;
  done: boolean;
  agentId?: string;
  status?: "running" | "completed" | "failed";
  googleTaskId?: string;
  parentId?: string;
  due?: string; // "YYYY-MM-DD"
};

type AgentStats = {
  totalCostUsd: number;
  totalTokens: number;
  totalWaitMs: number;
  tasksCompleted: number;
  tasksFailed: number;
};

type Dashboard = {
  overall: AgentStats & { runningCount: number };
  perAgent: (AgentStats & { agentId: string; name: string; running: boolean })[];
};

export function App() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_STORAGE_KEY) ?? "");
  const [connected, setConnected] = useState(false);
  const [panels, setPanels] = useState<Record<string, PanelState>>({});
  const [agentList, setAgentList] = useState<Agent[]>([]);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [newTodoText, setNewTodoText] = useState("");
  const [newTodoDue, setNewTodoDue] = useState("");
  const [subtaskDrafts, setSubtaskDrafts] = useState<Record<string, string>>({});
  const [openSubtaskFor, setOpenSubtaskFor] = useState<string | null>(null);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [googleConnected, setGoogleConnected] = useState(false);
  const [activeTab, setActiveTab] = useState<"dashboard" | "todo" | "chat">("chat");
  const sessionIdRef = useRef<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const hasAutoConnectedRef = useRef(false);

  const authHeaders = { "x-agent-office-token": token };

  const connectGoogle = () => {
    window.location.href = `${SERVER_URL}/auth/google`;
  };

  const syncGoogleTasks = async () => {
    const res = await fetch(`${SERVER_URL}/sync/google-tasks`, { method: "POST", headers: authHeaders });
    if (res.ok) {
      const data = await res.json();
      setTodos(data.todos);
    }
  };

  const refreshDashboard = async () => {
    const res = await fetch(`${SERVER_URL}/dashboard`, { headers: authHeaders });
    setDashboard(await res.json());
  };

  const updatePanel = (agentId: string, update: (panel: PanelState) => PanelState) => {
    setPanels((prev) => (prev[agentId] ? { ...prev, [agentId]: update(prev[agentId]) } : prev));
  };

  const connect = () => {
    const es = new EventSource(`${SERVER_URL}/stream?token=${encodeURIComponent(token)}`);

    es.addEventListener("session", async (event) => {
      sessionIdRef.current = event.data;
      setConnected(true);
      localStorage.setItem(TOKEN_STORAGE_KEY, token);

      const res = await fetch(`${SERVER_URL}/agents`, {
        headers: { "x-agent-office-token": token },
      });
      const list: Agent[] = await res.json();
      setAgentList(list);
      const initial: Record<string, PanelState> = {};
      for (const agent of list) {
        initial[agent.id] = { name: agent.name, lines: [], status: "idle", prompt: "" };
      }
      setPanels(initial);

      const todosRes = await fetch(`${SERVER_URL}/todos`, { headers: { "x-agent-office-token": token } });
      setTodos(await todosRes.json());

      const googleStatusRes = await fetch(`${SERVER_URL}/auth/google/status`, {
        headers: { "x-agent-office-token": token },
      });
      setGoogleConnected((await googleStatusRes.json()).connected);

      await refreshDashboard();
    });

    es.addEventListener("message", (event) => {
      const { agentId, todoId, message } = JSON.parse(event.data);
      if (message.type === "assistant") {
        const text = message.message.content
          .filter((block: { type: string }) => block.type === "text")
          .map((block: { text: string }) => block.text)
          .join("");
        if (text) {
          updatePanel(agentId, (panel) => ({
            ...panel,
            lines: [...panel.lines, { role: panel.name, text }],
          }));
        }
      } else if (message.type === "result") {
        updatePanel(agentId, (panel) => ({
          ...panel,
          status: message.is_error ? "failed" : "idle",
          lines: [...panel.lines, { role: "system", text: `完了: ${message.subtype}` }],
        }));
        if (todoId) {
          setTodos((prev) =>
            prev.map((t) =>
              t.id === todoId
                ? { ...t, status: message.is_error ? "failed" : "completed", done: !message.is_error }
                : t
            )
          );
        }
        refreshDashboard();
      }
    });

    es.onerror = () => {
      setConnected(false);
    };

    eventSourceRef.current = es;
  };

  // トークンが保存済みなら、開いた瞬間に自動接続する
  useEffect(() => {
    if (token && !hasAutoConnectedRef.current) {
      hasAutoConnectedRef.current = true;
      connect();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const send = async (agentId: string) => {
    const panel = panels[agentId];
    if (!sessionIdRef.current || !panel || !panel.prompt.trim() || panel.status === "running") return;

    const prompt = panel.prompt;
    updatePanel(agentId, (p) => ({
      ...p,
      status: "running",
      prompt: "",
      lines: [...p.lines, { role: "user", text: prompt }],
    }));

    const res = await fetch(`${SERVER_URL}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ sessionId: sessionIdRef.current, prompt, agentId }),
    });

    if (!res.ok) {
      updatePanel(agentId, (p) => ({ ...p, status: "failed" }));
    }
  };

  const addTodo = async () => {
    if (!newTodoText.trim()) return;
    const res = await fetch(`${SERVER_URL}/todos`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ text: newTodoText, due: newTodoDue || undefined }),
    });
    const todo: Todo = await res.json();
    setTodos((prev) => [...prev, todo]);
    setNewTodoText("");
    setNewTodoDue("");
  };

  const addSubtask = async (parentId: string) => {
    const text = subtaskDrafts[parentId]?.trim();
    if (!text) return;
    const res = await fetch(`${SERVER_URL}/todos`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ text, parentId }),
    });
    const todo: Todo = await res.json();
    setTodos((prev) => [...prev, todo]);
    setSubtaskDrafts((prev) => ({ ...prev, [parentId]: "" }));
  };

  const toggleTodoDone = async (todo: Todo) => {
    const res = await fetch(`${SERVER_URL}/todos/${todo.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ done: !todo.done }),
    });
    const updated: Todo = await res.json();
    setTodos((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
  };

  const assignTodo = async (todo: Todo, agentId: string) => {
    if (!sessionIdRef.current) return;
    setTodos((prev) =>
      prev.map((t) => (t.id === todo.id ? { ...t, agentId, status: "running" } : t))
    );
    const res = await fetch(`${SERVER_URL}/todos/${todo.id}/assign`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ sessionId: sessionIdRef.current, agentId }),
    });
    if (!res.ok) {
      setTodos((prev) =>
        prev.map((t) => (t.id === todo.id ? { ...t, status: "failed" } : t))
      );
    }
  };

  const formatDue = (due: string) => {
    const [, month, day] = due.split("-");
    return `${Number(month)}/${Number(day)}`;
  };

  const renderTodoRow = (todo: Todo, depth: number) => (
    <div
      key={todo.id}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.75rem",
        padding: "0.6rem 0.25rem",
        paddingLeft: `${0.25 + depth * 2}rem`,
        borderBottom: "1px solid #eee",
      }}
    >
      <div
        onClick={() => toggleTodoDone(todo)}
        role="checkbox"
        aria-checked={todo.done}
        style={{
          width: 20,
          height: 20,
          flexShrink: 0,
          borderRadius: "50%",
          border: todo.done ? "2px solid #4285f4" : "2px solid #999",
          background: todo.done ? "#4285f4" : "transparent",
          color: "white",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "0.7rem",
          cursor: "pointer",
        }}
      >
        {todo.done && "✓"}
      </div>

      {todo.googleTaskId && (
        <span
          title="Google Tasksから取り込み"
          style={{
            fontSize: "0.7rem",
            color: "#4285f4",
            border: "1px solid #4285f4",
            borderRadius: "999px",
            padding: "0 0.4rem",
            flexShrink: 0,
          }}
        >
          G
        </span>
      )}

      <span
        style={{
          flex: 1,
          color: todo.done ? "#999" : "#222",
          textDecoration: todo.done ? "line-through" : "none",
        }}
      >
        {todo.text}
      </span>

      {todo.due && (
        <span
          style={{
            fontSize: "0.75rem",
            color: "#666",
            border: "1px solid #ddd",
            borderRadius: "999px",
            padding: "0.1rem 0.5rem",
            flexShrink: 0,
          }}
        >
          {formatDue(todo.due)} 期限
        </span>
      )}

      {todo.status === "running" ? (
        <span style={{ fontSize: "0.8rem", color: "#666" }}>実行中...</span>
      ) : (
        <select
          defaultValue=""
          onChange={(e) => e.target.value && assignTodo(todo, e.target.value)}
          style={{
            fontSize: "0.8rem",
            borderRadius: "999px",
            padding: "0.2rem 0.6rem",
            border: "1px solid #ccc",
            background: "#fafafa",
          }}
        >
          <option value="" disabled>
            AIに振る
          </option>
          {agentList.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name}
            </option>
          ))}
        </select>
      )}
      {todo.status === "failed" && <span style={{ color: "#d93025", fontSize: "0.8rem" }}>失敗</span>}

      {depth === 0 && (
        <button
          onClick={() => setOpenSubtaskFor((prev) => (prev === todo.id ? null : todo.id))}
          title="サブタスクを追加"
          style={{ fontSize: "0.8rem", flexShrink: 0 }}
        >
          +
        </button>
      )}
    </div>
  );

  return (
    <div style={{ fontFamily: "sans-serif", maxWidth: 1100, margin: "2rem auto" }}>
      <h1>agent-office (M3)</h1>

      {!connected && (
        <div style={{ marginBottom: "1rem" }}>
          <input
            type="text"
            placeholder="サーバー起動時に表示されたトークン"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            style={{ width: "70%" }}
          />
          <button onClick={connect}>接続</button>
        </div>
      )}

      {connected && (
        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem", borderBottom: "1px solid #ccc" }}>
          {(
            [
              ["chat", "チャット"],
              ["todo", "Todo"],
              ["dashboard", "ダッシュボード"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              style={{
                padding: "0.5rem 1rem",
                border: "none",
                borderBottom: activeTab === key ? "2px solid #4285f4" : "2px solid transparent",
                background: "none",
                fontWeight: activeTab === key ? "bold" : "normal",
                cursor: "pointer",
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {connected && activeTab === "dashboard" && dashboard && (
        <div style={{ border: "1px solid #ccc", padding: "1rem", marginBottom: "1rem" }}>
          <h2 style={{ fontSize: "1.1rem" }}>ダッシュボード</h2>
          <p style={{ fontSize: "0.9rem" }}>
            稼働中: {dashboard.overall.runningCount} / 完了: {dashboard.overall.tasksCompleted} / 失敗:{" "}
            {dashboard.overall.tasksFailed} / トークン合計: {dashboard.overall.totalTokens} / 概算コスト: $
            {dashboard.overall.totalCostUsd.toFixed(4)} / 待ち時間合計:{" "}
            {(dashboard.overall.totalWaitMs / 1000).toFixed(1)}秒
          </p>
          <table style={{ fontSize: "0.85rem", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", paddingRight: "1rem" }}>部署</th>
                <th style={{ textAlign: "left", paddingRight: "1rem" }}>稼働状況</th>
                <th style={{ textAlign: "right", paddingRight: "1rem" }}>トークン</th>
                <th style={{ textAlign: "right", paddingRight: "1rem" }}>コスト($)</th>
                <th style={{ textAlign: "right", paddingRight: "1rem" }}>待ち時間(秒)</th>
                <th style={{ textAlign: "right", paddingRight: "1rem" }}>完了</th>
                <th style={{ textAlign: "right" }}>失敗</th>
              </tr>
            </thead>
            <tbody>
              {dashboard.perAgent.map((a) => (
                <tr key={a.agentId}>
                  <td style={{ paddingRight: "1rem" }}>{a.name}</td>
                  <td style={{ paddingRight: "1rem" }}>{a.running ? "実行中" : "待機"}</td>
                  <td style={{ textAlign: "right", paddingRight: "1rem" }}>{a.totalTokens}</td>
                  <td style={{ textAlign: "right", paddingRight: "1rem" }}>{a.totalCostUsd.toFixed(4)}</td>
                  <td style={{ textAlign: "right", paddingRight: "1rem" }}>{(a.totalWaitMs / 1000).toFixed(1)}</td>
                  <td style={{ textAlign: "right", paddingRight: "1rem" }}>{a.tasksCompleted}</td>
                  <td style={{ textAlign: "right" }}>{a.tasksFailed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {connected && activeTab === "todo" && (
        <div style={{ border: "1px solid #ccc", padding: "1rem", marginBottom: "1rem" }}>
          <h2 style={{ fontSize: "1.1rem" }}>
            Todo{" "}
            {googleConnected ? (
              <button onClick={syncGoogleTasks} style={{ fontSize: "0.8rem" }}>
                Googleと同期
              </button>
            ) : (
              <button onClick={connectGoogle} style={{ fontSize: "0.8rem" }}>
                Googleと連携する
              </button>
            )}
          </h2>
          <div style={{ marginBottom: "0.5rem" }}>
            <input
              type="text"
              placeholder="今日やること"
              value={newTodoText}
              onChange={(e) => setNewTodoText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addTodo()}
              style={{ width: "50%" }}
            />
            <input
              type="date"
              value={newTodoDue}
              onChange={(e) => setNewTodoDue(e.target.value)}
              style={{ marginLeft: "0.5rem" }}
            />
            <button onClick={addTodo}>追加</button>
          </div>
          <div>
            {todos
              .filter((todo) => !todo.parentId)
              .map((todo) => {
                const children = todos.filter((t) => t.parentId === todo.id);
                return (
                  <div key={todo.id}>
                    {renderTodoRow(todo, 0)}
                    {children.map((child) => renderTodoRow(child, 1))}
                    {openSubtaskFor === todo.id && (
                      <div style={{ display: "flex", gap: "0.5rem", padding: "0.3rem 0 0.3rem 2.75rem" }}>
                        <input
                          type="text"
                          placeholder="サブタスクを追加"
                          value={subtaskDrafts[todo.id] ?? ""}
                          onChange={(e) =>
                            setSubtaskDrafts((prev) => ({ ...prev, [todo.id]: e.target.value }))
                          }
                          onKeyDown={(e) => e.key === "Enter" && addSubtask(todo.id)}
                          style={{ flex: 1, fontSize: "0.85rem" }}
                        />
                        <button onClick={() => addSubtask(todo.id)} style={{ fontSize: "0.8rem" }}>
                          追加
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {connected && activeTab === "chat" && (
        <div style={{ display: "flex", gap: "1rem" }}>
          {Object.entries(panels).map(([agentId, panel]) => (
            <div key={agentId} style={{ flex: 1, border: "1px solid #ccc", padding: "1rem" }}>
              <h2 style={{ fontSize: "1.1rem" }}>
                {panel.name}{" "}
                <span style={{ fontSize: "0.8rem", color: "#666" }}>
                  (
                  {panel.status === "running" ? "実行中" : panel.status === "failed" ? "失敗" : "待機"}
                  )
                </span>
              </h2>

              <div style={{ minHeight: 200, marginBottom: "0.5rem", overflowY: "auto" }}>
                {panel.lines.map((line, i) => (
                  <p key={i} style={{ fontSize: "0.9rem" }}>
                    <strong>{line.role}:</strong> {line.text}
                  </p>
                ))}
              </div>

              <input
                type="text"
                value={panel.prompt}
                disabled={panel.status === "running"}
                onChange={(e) =>
                  updatePanel(agentId, (p) => ({ ...p, prompt: e.target.value }))
                }
                onKeyDown={(e) => e.key === "Enter" && send(agentId)}
                style={{ width: "100%", marginBottom: "0.5rem" }}
              />
              <button onClick={() => send(agentId)} disabled={panel.status === "running"}>
                送信
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
