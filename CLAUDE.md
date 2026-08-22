# agent-office

Claude Code の複数エージェントを「レトロなドット絵オフィス」として可視化・操作する、
常駐型のローカルWebアプリ。個人開発・実用ツール（練習用ではない）。

詳しい構想・非目標・マイルストーンは [docs/concept.md](docs/concept.md) を参照。
新しいセッションで作業を再開するときは、まず `docs/concept.md` の9-2（マイルストーン表、✅で完了記録）と
`git log` を見て現在地を把握すること。

## 現状

- M1（1エージェントとブラウザで話せる）: 完了
- M2（複数エージェントを切り替えて話せる）: 完了
- M3（2つ同時に走る）: 完了
- M4（進捗が見える）: 完了（M3の部署別パネルUIで達成、追加実装なし）
- M5（Todoから振れる）: 完了
- M6（ダッシュボード）: 完了
- **v1.0（実用完成）達成**。次はM7（ドット絵と環境音、v1.5）
- **Todo専用画面は廃止（2026-08-22）**。Google Tasksから一方向同期はバックグラウンドで継続、
  ブラウジングはGoogle Tasks側に任せる。agent-office側は各部署のエージェントが会話の中で
  未完了Todoに自然に触れる「ヒアリング」方式に変更（詳細は下記）

## 構成

```
server/            Node.js + Hono + @anthropic-ai/claude-agent-sdk
server/data/       Todo(todos.json)・Google OAuthトークン(google-auth.json)の永続化。
                   gitignore対象、実行時に自動生成
web/               React + TypeScript + Vite
templates/agents/  エージェント定義(Markdown, frontmatter: id/name + システムプロンプト本文)
docs/concept.md    構想メモ・マイルストーン記録
```

npm workspaces構成。依存関係はルートで `npm install`、各ワークスペースへの追加は
`npm install <pkg> -w server` / `-w web`。

## 開発フロー

- ブランチ構成は `master`（安定・動作確認済みのマイルストーン単位） → `dev`（統合ブランチ）
  → 機能ブランチ（例: `m3-parallel-execution`）の3層。実務に近い形にするため、あえて
  ソロ開発でもこの構成にしている。
- 機能ブランチは `dev` から切り、作業後は `dev` にマージ。`master`に直接コミットしない。
- マイルストーンの完了判定を満たし、動作確認が取れたら `dev` → `master` にマージしてpush。
- 動いた瞬間にコミットする（大きく壊れた状態のまま次に進まない）。
- マイルストーンが完了したら `docs/concept.md` の該当行に `✅日付` を追記する。

## 認証・セキュリティ（変更時に必ず維持すること）

- **課金方式**: Anthropic APIキーは同梱・使用しない。`server/.env` の `CLAUDE_CODE_OAUTH_TOKEN`
  （`claude setup-token` で発行、Pro/Maxサブスク経由・従量課金なし）を使う。
  `.env`は絶対にコミットしない（`.gitignore`済み）。
- **ローカルサーバーの防御**: `127.0.0.1` 固定バインド、Origin検証、`AGENT_OFFICE_TOKEN`
  （`server/.env`、秘密トークン）の3点セットを崩さないこと。新しいエンドポイントを追加する際も
  この認証ミドルウェアを通すこと。
- ブラウザの`EventSource`はカスタムヘッダーを送れないため、`/stream`はクエリパラメータでも
  トークンを受け付けている（`/chat`等の他エンドポイントはヘッダーのみ）。
- CORSは`hono/cors`で`http://localhost:5173`のみ許可。フロントのオリジンを変える場合は要修正。
- **エージェントのツール権限は許可リスト方式**（`server/src/index.ts`の`ALL_TOOLS`とagentの`allowedTools`の
  差分を`disallowedTools`に渡す）。新しいツールがAgent SDKに増えたら`ALL_TOOLS`に追記すること。
  **`Task`（サブエージェント起動）を許可リストに含めると、制限の緩いサブエージェントに委任して
  Bash等の制限を回避される**ので、部署エージェントには基本含めない。開発エージェントは`cwd`を
  プロジェクトルート(`PROJECT_ROOT`)に固定している。
- **Google Tasks連携**は一方向(Google→agent-officeの取り込みのみ、`tasks.readonly`スコープ)。
  `/auth/google`と`/auth/google/callback`だけは認証ミドルウェアの対象外（Googleからの外部
  リダイレクトが`x-agent-office-token`を持ってこられないため）。代わりに`state`パラメータで
  CSRFを防いでいる。この2ルート以外を対象外に広げないこと。設定は`server/.env`の
  `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`（READMEのセットアップ手順を参照）。

## Todoの扱い（画面なし、会話ヒアリング方式）

- `server/src/todos.ts`の`buildTodoContext()`が未完了Todo（親子関係込み）を短い箇条書きに整形し、
  `runTask()`が`agent.systemPrompt`に毎回追記する。専用UIはないので、Todoの追加・確認・完了操作は
  Google Tasksアプリ側で行う想定。
- ブラウザ側は接続時にGoogle連携済みなら自動で`/sync/google-tasks`を叩き、手動の「Todoを同期」
  ボタンもチャット/ホワイトボードのタブ横に残している。
- `/todos`のCRUDや`/todos/:id/assign`はAPIとしては残っているが、フロントのUIからは呼んでいない
  （直接API操作や将来の用途のために削除はしていない）。

## 実装上の注意

- `@anthropic-ai/claude-agent-sdk` は新しいため、AIが存在しないAPIを生成する可能性がある。
  実装前に `node_modules/@anthropic-ai/claude-agent-sdk/*.d.ts` を確認すること。
- 作者はJava経験者でJS/TSは学習中。async/await・React状態管理の説明は厚めに。
- エージェントのプロンプト精度（キャラ付け）の作り込みは意図的に後回し。ツール権限は
  8章の方針通り部署ごとに分離済み（`templates/agents/*.md`の`tools:`で宣言）。
