# agent-office

Claude Code の複数エージェントを「レトロなドット絵オフィス」として可視化・操作する、
常駐型のローカルWebアプリ（個人開発・構想段階）。

詳しい構想は [docs/concept.md](docs/concept.md) を参照。

## 現在の状態

**v1.0（実用完成）達成。** 複数エージェント切り替え・並行実行・Todo連携・ダッシュボードまで動作する。
残るはM7（ドット絵オフィス＋環境音、v1.5）。詳細は [docs/concept.md](docs/concept.md) の9-2マイルストーン表を参照。

## 構成

```
server/            Node.js + Hono + @anthropic-ai/claude-agent-sdk
server/data/       Todo・Google連携トークンの永続化（gitignore対象、実行時に自動生成）
web/               React + TypeScript + Vite
templates/agents/  エージェント定義（Markdown, frontmatter: id/name/tools + システムプロンプト本文）
docs/              構想メモ
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

### 4. Google Tasks連携（任意）

Google Tasksの未完了タスクをTodo一覧に取り込めます（一方向: Google→agent-office。完了・削除の逆反映はしません）。

1. [Google Cloud Console](https://console.cloud.google.com/) で新しいプロジェクトを作成
2. 「APIとサービス」→「ライブラリ」で **Google Tasks API** を有効化
3. 「APIとサービス」→「OAuth同意画面」を設定（User Type: External、公開ステータスは**テスト**のままでOK。テストユーザーに自分のGoogleアカウントを追加）
4. 「認証情報」→「認証情報を作成」→「OAuthクライアントID」
   - アプリケーションの種類: **ウェブアプリケーション**
   - 承認済みのリダイレクトURI: `http://127.0.0.1:3001/auth/google/callback`
5. 発行された **クライアントID** と **クライアントシークレット** を `server/.env` に追加

```
GOOGLE_CLIENT_ID=（発行されたクライアントID）
GOOGLE_CLIENT_SECRET=（発行されたクライアントシークレット）
```

6. サーバーを再起動し、ブラウザのTodoセクションにある「Googleと連携する」から認可（初回のみ）。以降は「Googleと同期」ボタンで取り込めます。

## セキュリティについて

- サーバーは `127.0.0.1` 固定でリッスン（外部ネットワークからアクセス不可）
- Origin検証と秘密トークンによる認証を実装済み

## ライセンス

未定（個人開発・構想段階のため）。
