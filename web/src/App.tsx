import { useRef, useState } from "react";

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

export function App() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_STORAGE_KEY) ?? "");
  const [connected, setConnected] = useState(false);
  const [panels, setPanels] = useState<Record<string, PanelState>>({});
  const sessionIdRef = useRef<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

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
      }
    });

    es.onerror = () => {
      setConnected(false);
    };

    eventSourceRef.current = es;
  };

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
      headers: {
        "Content-Type": "application/json",
        "x-agent-office-token": token,
      },
      body: JSON.stringify({ sessionId: sessionIdRef.current, prompt, agentId }),
    });

    if (!res.ok) {
      updatePanel(agentId, (p) => ({ ...p, status: "failed" }));
    }
  };

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
