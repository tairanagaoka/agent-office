import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const SERVER_URL = "http://127.0.0.1:3001";
const TOKEN_STORAGE_KEY = "agent-office-token";

// VSCode Dark+ 風の配色
const THEME = {
  bg: "#1e1e1e",
  panelBg: "#252526",
  panelBorder: "#3c3c3c",
  text: "#d4d4d4",
  textMuted: "#8a8a8a",
  accent: "#0e639c",
  accentHover: "#1177bb",
  accentText: "#ffffff",
  inputBg: "#3c3c3c",
  bubbleAssistant: "#2d2d2d",
  success: "#89d185",
  error: "#f14c4c",
  tabActive: "#007acc",
};

type ChatLine = {
  role: string;
  text: string;
};

// チャット吹き出し・資料タブ共通のMarkdown表示(見出し/箇条書き/表/コードブロックに対応)。
// 狭い吹き出しでも収まるよう.chat-markdownで余白・フォントサイズを詰めている。
function Markdown({ text }: { text: string }) {
  return (
    <div className="chat-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
}

type Agent = {
  id: string;
  name: string;
  tools: string[];
  scope: "global" | "project";
  department: string;
};

type Project = {
  id: string;
  name: string;
  path: string;
  createdAt: string;
};

type PanelState = {
  name: string;
  lines: ChatLine[];
  status: "idle" | "running" | "failed";
  prompt: string;
};

type DocumentEntry = {
  id: string;
  agentName: string;
  prompt: string;
  text: string;
  timestamp: number;
  projectId: string;
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

// 机・ブラウン管モニター・社員アバターのドット絵風アイコン。
// 画像素材を使わずSVGの矩形だけで組む(crispEdgesでアンチエイリアスを切ってドット感を出す)。
// 実行中はアバターの腕がキーボードを叩くようにアニメーションする。
function DeskIcon({ status }: { status: "idle" | "running" | "failed" }) {
  const screenColor = status === "running" ? "#7CFC9E" : status === "failed" ? "#ff6b6b" : "#3a3a3a";
  const glow = status === "idle" ? "none" : `0 0 6px ${screenColor}`;
  const isRunning = status === "running";

  return (
    <svg
      width="76"
      height="48"
      viewBox="0 0 76 48"
      shapeRendering="crispEdges"
      style={{ display: "block" }}
    >
      <style>
        {`
          @keyframes typingBounce {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-1.5px); }
          }
          .typing-arm { animation: typingBounce 0.5s ease-in-out infinite; }
        `}
      </style>

      {/* 机 */}
      <rect x="4" y="38" width="68" height="6" fill="#8a6540" />
      <rect x="6" y="44" width="4" height="4" fill="#5c4326" />
      <rect x="66" y="44" width="4" height="4" fill="#5c4326" />

      {/* 社員アバター */}
      <rect x="10" y="14" width="8" height="3" fill="#3a2a1a" />
      <rect x="10" y="14" width="8" height="8" fill="#e8b98a" />
      <rect x="8" y="22" width="12" height="12" fill="#4a6fa5" />
      <rect x="6" y="35" width="18" height="3" fill="#333" />
      <rect
        x="4"
        y="30"
        width="6"
        height="5"
        fill="#e8b98a"
        className={isRunning ? "typing-arm" : undefined}
        style={isRunning ? { animationDelay: "0s" } : undefined}
      />
      <rect
        x="20"
        y="30"
        width="6"
        height="5"
        fill="#e8b98a"
        className={isRunning ? "typing-arm" : undefined}
        style={isRunning ? { animationDelay: "0.25s" } : undefined}
      />

      {/* モニター本体 */}
      <rect x="34" y="10" width="28" height="22" fill="#3c3c3c" />
      <rect x="44" y="32" width="8" height="4" fill="#2d2d2d" />
      {/* 画面(稼働状態で色が変わる) */}
      <rect
        x="38"
        y="14"
        width="20"
        height="14"
        fill={screenColor}
        style={{ filter: glow !== "none" ? `drop-shadow(${glow})` : "none" }}
      />
      {/* 電源ランプ */}
      <rect x="58" y="28" width="2" height="2" fill={status === "idle" ? "#666" : "#ffdd55"} />
    </svg>
  );
}

const inputStyle = {
  background: THEME.inputBg,
  color: THEME.text,
  border: `1px solid ${THEME.panelBorder}`,
  borderRadius: "3px",
  padding: "0.4rem 0.6rem",
};

const buttonStyle = {
  background: THEME.accent,
  color: THEME.accentText,
  border: "none",
  borderRadius: "3px",
  padding: "0.4rem 0.9rem",
  cursor: "pointer",
};

export function App() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_STORAGE_KEY) ?? "");
  const [connected, setConnected] = useState(false);
  const [panels, setPanels] = useState<Record<string, PanelState>>({});
  const [agentList, setAgentList] = useState<Agent[]>([]);
  const [documents, setDocuments] = useState<DocumentEntry[]>([]);
  const [docsProjectFilter, setDocsProjectFilter] = useState("");
  const [activeTab, setActiveTab] = useState<"chat" | "documents" | "dashboard">("chat");
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentProjectId, setCurrentProjectId] = useState("self");
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectPath, setNewProjectPath] = useState("");
  const [projectError, setProjectError] = useState("");
  const [meetingTopic, setMeetingTopic] = useState("");
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

  const refreshDocuments = async (projectId?: string) => {
    const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
    const res = await fetch(`${SERVER_URL}/documents${query}`, { headers: authHeaders });
    setDocuments(await res.json());
  };

  const refreshProjects = async () => {
    const res = await fetch(`${SERVER_URL}/projects`, { headers: authHeaders });
    setProjects(await res.json());
  };

  const addProject = async () => {
    if (!newProjectName.trim() || !newProjectPath.trim()) return;
    setProjectError("");
    const res = await fetch(`${SERVER_URL}/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ name: newProjectName, path: newProjectPath }),
    });
    if (!res.ok) {
      setProjectError(await res.text());
      return;
    }
    const project: Project = await res.json();
    setProjects((prev) => [...prev, project]);
    setCurrentProjectId(project.id);
    setNewProjectName("");
    setNewProjectPath("");
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

      await refreshProjects();

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
      await refreshDocuments();
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
        // 資料(書斎)はサーバー側で.mdファイルとして保存されるので、完了のたびに取得し直す
        refreshDocuments();
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
      body: JSON.stringify({ sessionId: sessionIdRef.current, prompt, agentId, projectId: currentProjectId }),
    });

    if (!res.ok) {
      updatePanel(agentId, (p) => ({ ...p, status: "failed" }));
    }
  };

  const holdMeeting = async () => {
    if (!sessionIdRef.current || !meetingTopic.trim()) return;
    const topic = meetingTopic;
    setMeetingTopic("");

    const res = await fetch(`${SERVER_URL}/meeting`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ sessionId: sessionIdRef.current, prompt: topic, projectId: currentProjectId }),
    });
    if (!res.ok) return;

    // 実際に起動した部署のパネルだけ、議題をuser発言として表示し実行中にする
    // (secretaryは各部署の回答が出揃ってからサーバー側で起動するため、ここでは対象外)
    const { agentIds }: { agentIds: string[] } = await res.json();
    for (const agentId of agentIds) {
      updatePanel(agentId, (p) => ({
        ...p,
        status: "running",
        lines: [...p.lines, { role: "user", text: `[経営会議] ${topic}` }],
      }));
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
    <div style={{ fontFamily: "sans-serif", maxWidth: 1100, margin: "0 auto", padding: "2rem 1rem", color: THEME.text }}>
      <style>
        {`
          html { color-scheme: dark; }
          html, body { background: ${THEME.bg}; margin: 0; }
          button:hover { background: ${THEME.accentHover}; }
          input::placeholder { color: ${THEME.textMuted}; }
          .chat-markdown p { margin: 0.15rem 0; }
          .chat-markdown ul, .chat-markdown ol { margin: 0.25rem 0; padding-left: 1.25rem; }
          .chat-markdown h1, .chat-markdown h2, .chat-markdown h3 { font-size: 1em; margin: 0.4rem 0 0.2rem; color: ${THEME.text}; }
          .chat-markdown a { color: #3794ff; }
          .chat-markdown pre { background: ${THEME.bg}; border: 1px solid ${THEME.panelBorder}; padding: 0.5rem; border-radius: 4px; overflow-x: auto; font-size: 0.8rem; }
          .chat-markdown code { background: ${THEME.inputBg}; padding: 0 0.25rem; border-radius: 3px; font-size: 0.85em; }
          .chat-markdown pre code { background: none; padding: 0; }
          .chat-markdown table { border-collapse: collapse; font-size: 0.85rem; }
          .chat-markdown th, .chat-markdown td { border: 1px solid ${THEME.panelBorder}; padding: 0.25rem 0.5rem; }
          .chat-markdown blockquote { margin: 0.25rem 0; padding-left: 0.75rem; border-left: 3px solid ${THEME.panelBorder}; color: ${THEME.textMuted}; }
        `}
      </style>
      <h1 style={{ color: THEME.text }}>agent-office</h1>

      {!connected && (
        <div style={{ marginBottom: "1rem" }}>
          <input
            type="text"
            placeholder="サーバー起動時に表示されたトークン"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            style={{ ...inputStyle, width: "70%" }}
          />
          <button onClick={connect} style={{ ...buttonStyle, marginLeft: "0.5rem" }}>
            接続
          </button>
        </div>
      )}

      {connected && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: "0.5rem",
            marginBottom: "1rem",
            padding: "0.75rem",
            background: THEME.panelBg,
            border: `1px solid ${THEME.panelBorder}`,
            borderRadius: "4px",
          }}
        >
          <span style={{ fontSize: "0.85rem", color: THEME.textMuted }}>プロジェクト:</span>
          <select
            value={currentProjectId}
            onChange={(e) => setCurrentProjectId(e.target.value)}
            style={{ ...inputStyle, padding: "0.3rem 0.5rem" }}
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <input
            type="text"
            placeholder="新規プロジェクト名"
            value={newProjectName}
            onChange={(e) => setNewProjectName(e.target.value)}
            style={{ ...inputStyle, width: "10rem" }}
          />
          <input
            type="text"
            placeholder="絶対パス(例: C:\Git\my-app)"
            value={newProjectPath}
            onChange={(e) => setNewProjectPath(e.target.value)}
            style={{ ...inputStyle, width: "16rem" }}
          />
          <button onClick={addProject} style={buttonStyle}>
            プロジェクトを登録
          </button>
          {projectError && <span style={{ color: THEME.error, fontSize: "0.8rem" }}>{projectError}</span>}
        </div>
      )}

      {connected && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            marginBottom: "1rem",
            padding: "0.75rem",
            background: THEME.panelBg,
            border: `1px solid ${THEME.panelBorder}`,
            borderRadius: "4px",
          }}
        >
          <span style={{ fontSize: "0.85rem", color: THEME.textMuted }}>経営会議:</span>
          <input
            type="text"
            placeholder="議題を入力(各部署に一斉に投げ、秘書がOpusでまとめます)"
            value={meetingTopic}
            onChange={(e) => setMeetingTopic(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && holdMeeting()}
            style={{ ...inputStyle, flex: 1 }}
          />
          <button onClick={holdMeeting} style={buttonStyle}>
            会議を開く
          </button>
        </div>
      )}

      {connected && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "1rem",
            borderBottom: `1px solid ${THEME.panelBorder}`,
          }}
        >
          <div style={{ display: "flex", gap: "0.5rem" }}>
            {(
              [
                ["chat", "チャット"],
                ["documents", "資料"],
                ["dashboard", "ホワイトボード"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                style={{
                  padding: "0.5rem 1rem",
                  border: "none",
                  borderBottom: activeTab === key ? `2px solid ${THEME.tabActive}` : "2px solid transparent",
                  background: "none",
                  color: activeTab === key ? THEME.text : THEME.textMuted,
                  fontWeight: activeTab === key ? "bold" : "normal",
                  cursor: "pointer",
                }}
              >
                {label}
              </button>
            ))}
          </div>

          <div style={{ fontSize: "0.8rem", paddingBottom: "0.5rem" }}>
            {googleConnected ? (
              <button onClick={syncGoogleTasks} style={buttonStyle}>
                Todoを同期
              </button>
            ) : (
              <button onClick={connectGoogle} style={buttonStyle}>
                Google Tasksと連携する
              </button>
            )}
            {googleSyncNote && <span style={{ color: THEME.textMuted, marginLeft: "0.5rem" }}>{googleSyncNote}</span>}
          </div>
        </div>
      )}

      {connected && activeTab === "dashboard" && dashboard && (
        <div style={{ background: THEME.panelBg, border: `1px solid ${THEME.panelBorder}`, borderRadius: "4px", padding: "1rem", marginBottom: "1rem" }}>
          <h2 style={{ fontSize: "1.1rem", marginTop: 0 }}>ホワイトボード</h2>

          {dashboard.rateLimits.length > 0 && (
            <div style={{ marginBottom: "1rem" }}>
              <strong style={{ fontSize: "0.9rem" }}>Claude Codeの利用枠(サブスク全体)</strong>
              {dashboard.rateLimits.map((rl) => (
                <p key={rl.rateLimitType} style={{ fontSize: "0.95rem", margin: "0.25rem 0" }}>
                  <strong>{RATE_LIMIT_LABELS[rl.rateLimitType ?? ""] ?? rl.rateLimitType}</strong>:{" "}
                  {RATE_LIMIT_STATUS_LABELS[rl.status] ?? rl.status}
                  {rl.utilization != null && `（使用率 ${Math.round(rl.utilization * 100)}%）`}
                  {rl.resetsAt && (
                    <span style={{ color: THEME.textMuted }}> ・ {formatRelativeReset(rl.resetsAt)}</span>
                  )}
                </p>
              ))}
            </div>
          )}

          <p style={{ fontSize: "0.9rem" }}>
            稼働中: {dashboard.overall.runningCount} / 完了: {dashboard.overall.tasksCompleted} / 失敗:{" "}
            {dashboard.overall.tasksFailed} / トークン合計: {dashboard.overall.totalTokens} / 待ち時間合計:{" "}
            {(dashboard.overall.totalWaitMs / 1000).toFixed(1)}秒
            <span style={{ color: THEME.textMuted, fontSize: "0.8rem" }}>
              {" "}
              (概算コスト ${dashboard.overall.totalCostUsd.toFixed(4)})
            </span>
          </p>
          <table style={{ fontSize: "0.85rem", borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", paddingRight: "1rem", borderBottom: `1px solid ${THEME.panelBorder}` }}>部署</th>
                <th style={{ textAlign: "left", paddingRight: "1rem", borderBottom: `1px solid ${THEME.panelBorder}` }}>稼働状況</th>
                <th style={{ textAlign: "right", paddingRight: "1rem", borderBottom: `1px solid ${THEME.panelBorder}` }}>トークン</th>
                <th style={{ textAlign: "right", paddingRight: "1rem", borderBottom: `1px solid ${THEME.panelBorder}` }}>待ち時間(秒)</th>
                <th style={{ textAlign: "right", paddingRight: "1rem", borderBottom: `1px solid ${THEME.panelBorder}` }}>完了</th>
                <th style={{ textAlign: "right", paddingRight: "1rem", borderBottom: `1px solid ${THEME.panelBorder}` }}>失敗</th>
                <th style={{ textAlign: "right", color: THEME.textMuted, fontWeight: "normal", borderBottom: `1px solid ${THEME.panelBorder}` }}>概算コスト($)</th>
              </tr>
            </thead>
            <tbody>
              {dashboard.perAgent.map((a) => (
                <tr key={a.agentId}>
                  <td style={{ paddingRight: "1rem", padding: "0.3rem 1rem 0.3rem 0" }}>{a.name}</td>
                  <td style={{ paddingRight: "1rem", color: a.running ? THEME.success : THEME.textMuted }}>
                    {a.running ? "実行中" : "待機"}
                  </td>
                  <td style={{ textAlign: "right", paddingRight: "1rem" }}>{a.totalTokens}</td>
                  <td style={{ textAlign: "right", paddingRight: "1rem" }}>{(a.totalWaitMs / 1000).toFixed(1)}</td>
                  <td style={{ textAlign: "right", paddingRight: "1rem" }}>{a.tasksCompleted}</td>
                  <td style={{ textAlign: "right", paddingRight: "1rem", color: a.tasksFailed > 0 ? THEME.error : THEME.text }}>
                    {a.tasksFailed}
                  </td>
                  <td style={{ textAlign: "right", color: THEME.textMuted }}>{a.totalCostUsd.toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {connected && activeTab === "documents" && (
        <div style={{ background: THEME.panelBg, border: `1px solid ${THEME.panelBorder}`, borderRadius: "4px", padding: "1rem", marginBottom: "1rem" }}>
          <h2 style={{ fontSize: "1.1rem", marginTop: 0 }}>資料</h2>
          <div style={{ marginBottom: "0.75rem" }}>
            <select
              value={docsProjectFilter}
              onChange={(e) => {
                setDocsProjectFilter(e.target.value);
                refreshDocuments(e.target.value || undefined);
              }}
              style={{ ...inputStyle, padding: "0.3rem 0.5rem" }}
            >
              <option value="">すべてのプロジェクト</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          {documents.length === 0 ? (
            <p style={{ fontSize: "0.9rem", color: THEME.textMuted }}>まだ資料はありません。</p>
          ) : (
            documents.map((doc) => (
              <div
                key={doc.id}
                style={{
                  border: `1px solid ${THEME.panelBorder}`,
                  borderRadius: "6px",
                  padding: "1rem",
                  marginBottom: "1rem",
                  background: THEME.bg,
                }}
              >
                <div style={{ fontSize: "0.8rem", color: THEME.textMuted, marginBottom: "0.5rem" }}>
                  <strong style={{ color: THEME.text }}>{doc.agentName}</strong> ・{" "}
                  {new Date(doc.timestamp).toLocaleString("ja-JP")} ・{" "}
                  {projects.find((p) => p.id === doc.projectId)?.name ?? doc.projectId}
                  {doc.prompt && <> ・ 依頼内容: {doc.prompt}</>}
                </div>
                <Markdown text={doc.text} />
              </div>
            ))
          )}
        </div>
      )}

      {connected && activeTab === "chat" && (() => {
        // agentListの登場順を保ったまま部署ごとにグルーピングする
        const departmentOrder: string[] = [];
        const departmentAgents: Record<string, string[]> = {};
        for (const agent of agentList) {
          if (!departmentAgents[agent.department]) {
            departmentAgents[agent.department] = [];
            departmentOrder.push(agent.department);
          }
          departmentAgents[agent.department].push(agent.id);
        }

        return (
          <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
            {departmentOrder.map((department) => (
              <div key={department}>
                <h2 style={{ fontSize: "1rem", color: THEME.textMuted, marginBottom: "0.5rem" }}>{department}</h2>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem" }}>
                  {departmentAgents[department].map((agentId) => {
                    const panel = panels[agentId];
                    if (!panel) return null;
                    const agentMeta = agentList.find((a) => a.id === agentId);
                    return (
                      <div
                        key={agentId}
                        style={{
                          flex: "1 1 280px",
                          minWidth: 280,
                          background: THEME.panelBg,
                          border: `1px solid ${THEME.panelBorder}`,
                          borderRadius: "4px",
                          padding: "1rem",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.5rem" }}>
                          <DeskIcon status={panel.status} />
                          <h2 style={{ fontSize: "1.1rem", margin: 0 }}>
                            {panel.name}{" "}
                            <span
                              style={{
                                fontSize: "0.8rem",
                                color:
                                  panel.status === "running"
                                    ? THEME.success
                                    : panel.status === "failed"
                                      ? THEME.error
                                      : THEME.textMuted,
                              }}
                            >
                              ({panel.status === "running" ? "実行中" : panel.status === "failed" ? "失敗" : "待機"})
                            </span>
                            {agentMeta?.scope === "global" && (
                              <span style={{ fontSize: "0.7rem", color: THEME.textMuted, marginLeft: "0.4rem" }}>
                                (全プロジェクト共通)
                              </span>
                            )}
                          </h2>
                        </div>

                        <div style={{ minHeight: 200, marginBottom: "0.5rem", overflowY: "auto" }}>
                          {panel.lines.map((line, i) => {
                            if (line.role === "system") {
                              return (
                                <div
                                  key={i}
                                  style={{
                                    textAlign: "center",
                                    fontSize: "0.75rem",
                                    color: THEME.textMuted,
                                    margin: "0.6rem 0",
                                  }}
                                >
                                  {line.text}
                                </div>
                              );
                            }
                            const isUser = line.role === "user";
                            return (
                              <div
                                key={i}
                                style={{
                                  display: "flex",
                                  justifyContent: isUser ? "flex-end" : "flex-start",
                                  margin: "0.4rem 0",
                                }}
                              >
                                <div
                                  style={{
                                    maxWidth: "85%",
                                    background: isUser ? THEME.accent : THEME.bubbleAssistant,
                                    color: isUser ? THEME.accentText : THEME.text,
                                    borderRadius: "10px",
                                    padding: "0.5rem 0.75rem",
                                    fontSize: "0.9rem",
                                    overflowWrap: "break-word",
                                  }}
                                >
                                  {!isUser && (
                                    <div
                                      style={{
                                        fontSize: "0.7rem",
                                        fontWeight: "bold",
                                        color: THEME.textMuted,
                                        marginBottom: "0.2rem",
                                      }}
                                    >
                                      {line.role}
                                    </div>
                                  )}
                                  <Markdown text={line.text} />
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        <input
                          type="text"
                          value={panel.prompt}
                          disabled={panel.status === "running"}
                          onChange={(e) => updatePanel(agentId, (p) => ({ ...p, prompt: e.target.value }))}
                          onKeyDown={(e) => e.key === "Enter" && send(agentId)}
                          style={{ ...inputStyle, width: "100%", marginBottom: "0.5rem", boxSizing: "border-box" }}
                        />
                        <button
                          onClick={() => send(agentId)}
                          disabled={panel.status === "running"}
                          style={buttonStyle}
                        >
                          送信
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        );
      })()}
    </div>
  );
}
