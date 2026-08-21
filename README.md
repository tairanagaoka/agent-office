# agent-office

Claude Code の複数エージェントを「レトロなドット絵オフィス」として可視化・操作する、
常駐型のローカルWebアプリ（個人開発・構想段階）。

詳しい構想は [docs/concept.md](docs/concept.md) を参照。

## 現在の状態

- **M1: 達成** — 1エージェントとブラウザでチャットできる（SSEでストリーミング応答）
- M2以降（複数エージェント切り替え、並行実行、進捗表示、Todo連携、ダッシュボード、ドット絵化）は未着手

## 構成

```
server/   Node.js + Hono + @anthropic-ai/claude-agent-sdk
web/      React + TypeScript + Vite
docs/     構想メモ
```

npm workspaces構成（ルートの `package.json` で `server`/`web` を管理）。

## セットアップ

### 前提

- Node.js 18+
- Claude Pro / Max などのClaude Codeサブスクリプション

### 1. 依存関係のインストール

```bash
npm install
```

### 2. 認証設定

このアプリは**追加課金なし**で、あなた自身のClaude Codeサブスクリプションを使います。
Anthropic APIキーは不要・同梱もしていません。

```bash
npm install -g @anthropic-ai/claude-code   # claude CLIが未インストールの場合
claude setup-token                          # ブラウザで承認 → 長期トークンが発行される
```

`server/.env` を作成し、発行されたトークンを設定します。

```
CLAUDE_CODE_OAUTH_TOKEN=（発行されたトークン）
AGENT_OFFICE_TOKEN=（任意の文字列。ローカルサーバーへのアクセスを守る秘密トークン）
```

`AGENT_OFFICE_TOKEN` を省略した場合、サーバー起動時に一時トークンが自動生成されコンソールに表示されます（再起動のたびに変わるので、固定したい場合は表示された値を`.env`に書いてください）。

### 3. 起動

```bash
npm run dev -w server   # http://127.0.0.1:3001
npm run dev -w web      # http://localhost:5173
```

`http://localhost:5173` を開き、`AGENT_OFFICE_TOKEN`の値を入力して接続してください（一度接続すればブラウザに記憶されます）。

## セキュリティについて

- サーバーは `127.0.0.1` 固定でリッスン（外部ネットワークからアクセス不可）
- Origin検証と秘密トークンによる認証を実装済み

## ライセンス

未定（個人開発・構想段階のため）。
