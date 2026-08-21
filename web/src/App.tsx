import { useRef, useState } from "react";

const SERVER_URL = "http://127.0.0.1:3001";
const TOKEN_STORAGE_KEY = "agent-office-token";

type ChatLine = {
  role: "user" | "assistant" | "system";
  text: string;
};

export function App() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_STORAGE_KEY) ?? "");
  const [connected, setConnected] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [lines, setLines] = useState<ChatLine[]>([]);
  const sessionIdRef = useRef<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const connect = () => {
    const es = new EventSource(`${SERVER_URL}/stream?token=${encodeURIComponent(token)}`);

    es.addEventListener("session", (event) => {
      sessionIdRef.current = event.data;
      setConnected(true);
      localStorage.setItem(TOKEN_STORAGE_KEY, token);
    });

    es.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.type === "assistant") {
        const text = message.message.content
          .filter((block: { type: string }) => block.type === "text")
          .map((block: { text: string }) => block.text)
          .join("");
        if (text) {
          setLines((prev) => [...prev, { role: "assistant", text }]);
        }
      } else if (message.type === "result") {
        setLines((prev) => [...prev, { role: "system", text: `完了: ${message.subtype}` }]);
      }
    });

    es.onerror = () => {
      setConnected(false);
    };

    eventSourceRef.current = es;
  };

  const send = async () => {
    if (!sessionIdRef.current || !prompt.trim()) return;
    setLines((prev) => [...prev, { role: "user", text: prompt }]);
    await fetch(`${SERVER_URL}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-agent-office-token": token,
      },
      body: JSON.stringify({ sessionId: sessionIdRef.current, prompt }),
    });
    setPrompt("");
  };

  return (
    <div style={{ fontFamily: "sans-serif", maxWidth: 640, margin: "2rem auto" }}>
      <h1>agent-office (M1)</h1>

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

      <div style={{ border: "1px solid #ccc", padding: "1rem", minHeight: 200, marginBottom: "1rem" }}>
        {lines.map((line, i) => (
          <p key={i}>
            <strong>{line.role}:</strong> {line.text}
          </p>
        ))}
      </div>

      {connected && (
        <div>
          <input
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            style={{ width: "70%" }}
          />
          <button onClick={send}>送信</button>
        </div>
      )}
    </div>
  );
}
