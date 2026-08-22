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

type AgentStats = {
  totalCostUsd: number;
  totalTokens: number;
  totalWaitMs: number;
  tasksCompleted: number;
  tasksFailed: number;
};

type RateLimitInfo = {
  status: "allowed" | "allowed_warning" | "rejected";
  resetsAt?: number;
  rateLimitType?: string;
  utilization?: number;
};

type Dashboard = {
  overall: AgentStats & { runningCount: number };
  perAgent: (AgentStats & { agentId: string; name: string; running: boolean })[];
  rateLimits: RateLimitInfo[];
};

export function App() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_STORAGE_KEY) ?? "");
  const [connected, setConnected] = useState(false);
  const [panels, setPanels] = useState<Record<string, PanelState>>({});
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [googleConnected, setGoogleConnected] = useState(false);
  const [googleSyncNote, setGoogleSyncNote] = useState(() => {
    if (new URLSearchParams(window.location.search).has("google_auth_error")) {
      window.history.replaceState(null, "", window.location.pathname);
      return "Google連携に失敗しました。もう一度お試しください。";
    }
    return "";
  });
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
      setGoogleSyncNote(`${data.added}件のTodoを取り込みました`);
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
      const initial: Record<string, PanelState> = {};
      for (const agent of list) {
        initial[agent.id] = { name: agent.name, lines: [], status: "idle", prompt: "" };
      }
      setPanels(initial);

      const googleStatusRes = await fetch(`${SERVER_URL}/auth/google/status`, {
        headers: { "x-agent-office-token": token },
      });
      const { connected: gConnected } = await googleStatusRes.json();
      setGoogleConnected(gConnected);
      // Todo専用画面は廃止したので、接続時にバックグラウンドで同期しておき、
      // 各部署のエージェントが会話の中で自然に触れられるようにする
      if (gConnected) {
        await fetch(`${SERVER_URL}/sync/google-tasks`, { method: "POST", headers: { "x-agent-office-token": token } });
      }

      await refreshDashboard();
    });

    es.addEventListener("message", (event) => {
      const { agentId, message } = JSON.parse(event.data);
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

  const RATE_LIMIT_LABELS: Record<string, string> = {
    five_hour: "5時間ウィンドウ",
    seven_day: "7日ウィンドウ",
    seven_day_opus: "7日ウィンドウ(Opus)",
    seven_day_sonnet: "7日ウィンドウ(Sonnet)",
  };

  const RATE_LIMIT_STATUS_LABELS: Record<string, string> = {
    allowed: "利用可能",
    allowed_warning: "利用可能(残りわずか)",
    rejected: "上限に到達",
  };

  const formatRelativeReset = (resetsAt: number) => {
    const diffMs = resetsAt * 1000 - Date.now();
    if (diffMs <= 0) return "まもなくリセット";
    const totalMinutes = Math.round(diffMs / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours === 0) return `あと${minutes}分でリセット`;
    return `あと${hours}時間${minutes}分でリセット`;
  };

  return (
    <div style={{ fontFamily: "sans-serif", maxWidth: 1100, margin: "2rem auto" }}>
      <h1>agent-office</h1>

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
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            marginBottom: "1rem",
            fontSize: "0.8rem",
          }}
        >
          {googleConnected ? (
            <button onClick={syncGoogleTasks}>Todoを同期</button>
          ) : (
            <button onClick={connectGoogle}>Google Tasksと連携する</button>
          )}
          {googleSyncNote && <span style={{ color: "#666", marginLeft: "0.5rem" }}>{googleSyncNote}</span>}
        </div>
      )}

      {connected && dashboard && (
        <div style={{ border: "1px solid #ccc", padding: "1rem", marginBottom: "1rem" }}>
          <h2 style={{ fontSize: "1.1rem" }}>ホワイトボード</h2>

          {dashboard.rateLimits.length > 0 && (
            <div style={{ marginBottom: "1rem" }}>
              <strong style={{ fontSize: "0.9rem" }}>Claude Codeの利用枠(サブスク全体)</strong>
              {dashboard.rateLimits.map((rl) => (
                <p key={rl.rateLimitType} style={{ fontSize: "0.95rem", margin: "0.25rem 0" }}>
                  <strong>{RATE_LIMIT_LABELS[rl.rateLimitType ?? ""] ?? rl.rateLimitType}</strong>:{" "}
                  {RATE_LIMIT_STATUS_LABELS[rl.status] ?? rl.status}
                  {rl.utilization != null && `（使用率 ${Math.round(rl.utilization * 100)}%）`}
                  {rl.resetsAt && (
                    <span style={{ color: "#666" }}> ・ {formatRelativeReset(rl.resetsAt)}</span>
                  )}
                </p>
              ))}
            </div>
          )}

          <p style={{ fontSize: "0.9rem" }}>
            稼働中: {dashboard.overall.runningCount} / 完了: {dashboard.overall.tasksCompleted} / 失敗:{" "}
            {dashboard.overall.tasksFailed} / トークン合計: {dashboard.overall.totalTokens} / 待ち時間合計:{" "}
            {(dashboard.overall.totalWaitMs / 1000).toFixed(1)}秒
            <span style={{ color: "#999", fontSize: "0.8rem" }}>
              {" "}
              (概算コスト ${dashboard.overall.totalCostUsd.toFixed(4)})
            </span>
          </p>
          <table style={{ fontSize: "0.85rem", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", paddingRight: "1rem" }}>部署</th>
                <th style={{ textAlign: "left", paddingRight: "1rem" }}>稼働状況</th>
                <th style={{ textAlign: "right", paddingRight: "1rem" }}>トークン</th>
                <th style={{ textAlign: "right", paddingRight: "1rem" }}>待ち時間(秒)</th>
                <th style={{ textAlign: "right", paddingRight: "1rem" }}>完了</th>
                <th style={{ textAlign: "right", paddingRight: "1rem" }}>失敗</th>
                <th style={{ textAlign: "right", color: "#999", fontWeight: "normal" }}>概算コスト($)</th>
              </tr>
            </thead>
            <tbody>
              {dashboard.perAgent.map((a) => (
                <tr key={a.agentId}>
                  <td style={{ paddingRight: "1rem" }}>{a.name}</td>
                  <td style={{ paddingRight: "1rem" }}>{a.running ? "実行中" : "待機"}</td>
                  <td style={{ textAlign: "right", paddingRight: "1rem" }}>{a.totalTokens}</td>
                  <td style={{ textAlign: "right", paddingRight: "1rem" }}>{(a.totalWaitMs / 1000).toFixed(1)}</td>
                  <td style={{ textAlign: "right", paddingRight: "1rem" }}>{a.tasksCompleted}</td>
                  <td style={{ textAlign: "right", paddingRight: "1rem" }}>{a.tasksFailed}</td>
                  <td style={{ textAlign: "right", color: "#999" }}>{a.totalCostUsd.toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {connected && (
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
