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
- **v1.0（実用完成）達成**。M7（ドット絵と環境音、v1.5）は着手中
- **v2.0の一般公開は中止（2026-08-22）**。agent-officeは自分専用ツールとして育てる方針に変更。
  8章の配布要件（LICENSE等）は不要、セキュリティ要件は自衛のため引き続き維持する。
- **Todo専用画面は廃止（2026-08-22）**。Google Tasksから一方向同期はバックグラウンドで継続、
  ブラウジングはGoogle Tasks側に任せる。agent-office側は各部署のエージェントが会話の中で
  未完了Todoに自然に触れる「ヒアリング」方式に変更（詳細は下記）
- **複数プロジェクト対応を追加（2026-08-22）**。agent-officeを「AI駆動開発を量産する会社
  ダッシュボード」にする方針のもと、部署を8つ（実装/テスト/レビュー/調査/企画/広報/総務/経理）に
  拡張し、実装系の部署は選択中のプロジェクト（agent-office自身とは別のディレクトリでもよい）に
  向けて動くようにした（詳細は下記「複数プロジェクト対応」）
- **経営会議機能を追加（2026-08-22）**。各部署に一斉に意見を聞き、Opusで動く秘書エージェントが
  提言にまとめる機能。部署は秘書室を加えて9つになった（詳細は下記「経営会議」）

## 構成

```
server/            Node.js + Hono + @anthropic-ai/claude-agent-sdk
server/src/projects.ts  プロジェクト(agent-office自身+別ディレクトリ)の登録・管理
server/data/       Todo(todos.json)・Google OAuthトークン(google-auth.json)・
                   資料/書斎(documents/*.md)・プロジェクト一覧(projects.json)の永続化。
                   gitignore対象、実行時に自動生成
web/               React + TypeScript + Vite
templates/agents/  エージェント定義(Markdown, frontmatter: id/name/tools/scope + システムプロンプト本文)
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
  Bash等の制限を回避される**ので、部署エージェントには基本含めない。
  **`Bash`を持つエージェントに書き込み権限なしを謳うのは無意味**（`bash -c "echo>file"`で回避できる）。
  レビュー担当のように「書き込みさせない」ことが目的の部署にはBashも含めないこと。
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

## 資料（書斎、5-4）

- `server/src/documents.ts`が担当。`runTask()`内でSDKの`assistant`メッセージから
  テキストを蓄積し、タスク完了時に`server/data/documents/{timestamp}-{id}.md`として
  frontmatter(id/agent/prompt/timestamp)付きで保存する。ブラウザを閉じていても残る。
- フロントは`GET /documents`で読み込み、接続時とタスク完了ごとに再取得する
  （サーバー側が正、フロント側での組み立てはしない）。
- Markdown表示は`react-markdown` + `remark-gfm`を使用（見出し・表・コードブロック等に対応）。
  `.chat-markdown`クラスで狭い吹き出し用に余白を詰めている。

## 複数プロジェクト対応

- `server/src/projects.ts`が担当。`server/data/projects.json`に永続化し、初回起動時に
  `id: "self"`（agent-office自身のディレクトリ）を自動シードする。
- **projectIdは`/chat`等で常に必須**（未指定時に暗黙で`self`に倒すような分岐は作らない）。
  存在しないprojectIdを渡すと404で明示的に失敗する（静かに別ディレクトリへ差し替わるのを防ぐため）。
- `templates/agents/*.md`の`scope:`（`global`か`project`）で、そのエージェントが常に
  agent-office自身のディレクトリで動くか、選択中プロジェクトのディレクトリで動くかを宣言する。
  未指定/パース失敗時は`global`にフォールバックする（安全側）。現状`life`(総務部)のみ`global`。
- 並行実行のロックキーは`` `${sessionId}:${projectId}:${agentId}` ``（`server/src/index.ts`の
  `startAgentTurn()`内）。projectIdを含めることで、同じ部署が別プロジェクトでは並行して動ける。
- **プロジェクト登録はユーザーがUIのフォームから行う操作のみ**（`POST /projects`）。エージェントが
  自分でプロジェクトを追加したり任意のパスを選んだりする経路(MCPツール等)は作らないこと。
  登録時は`fs.existsSync && isDirectory`で検証し、存在しないパスは400で拒否する。
- `PROJECT_ROOT`（agent-office自身の設置場所。`templates/agents/`や`server/data/`を探す基準）と、
  各`Project.path`（ユーザーが登録した個別プロジェクトのパス）は別概念。混同しないこと。

## 経営会議（Management Meeting）

- `startAgentTurn()`は`taskId`だけでなく`done: Promise<{text, failed}>`も返す`TaskHandle`を返す
  （`server/src/index.ts`）。通常の`/chat`はこれまで通り`.done`を無視した fire-and-forget、
  `/meeting`だけが複数の`.done`を`await`して後続処理（秘書への引き継ぎ）に使う。
- `POST /meeting {sessionId, prompt, projectId}`は、`agents`マップを走査して**部署(`department`)ごとに
  最初の1エージェントだけ**を代表として選び（秘書室自身は除外）、同じ`prompt`で全員を並行実行する。
  各代表の応答は普段通り自分の既存チャットパネルにSSEで流れるので、会議専用のUIは作っていない。
- 全代表の`.done`が揃った後（バックグラウンドの即時実行関数内）、`## {部署名}の意見\n{本文}`形式で
  ダイジェストを組み立て、`秘書`エージェント（`templates/agents/secretary.md`）に
  「経営会議の議題:...」「各部署からの回答:...」「上記を踏まえて所長への提言をまとめてください」という
  プロンプトで引き継ぐ。秘書の応答も他部署と同じ仕組みで自分のパネルに表示される。
- **`model:` frontmatterフィールド**（`server/src/agents.ts`の`AgentDef`に追加）は`query()`の
  `options.model`にそのまま渡る（`'opus'`/`'sonnet'`等のエイリアスを受け付ける）。未指定ならSDK既定
  （Sonnet相当）。秘書エージェントだけ`model: opus`を指定し、複数部署の意見を俯瞰する役割に
  合わせて上位モデルを使う。
- 部署の代表選出は「`agents`マップに登録された順で部署ごとに最初の1人」なので、開発室のように
  部署内に複数ロール（実装/テスト/レビュー/調査）がいる場合は`templates/agents/`内のファイル順
  （＝読み込み順）で決まる代表1人だけが会議に出る。全ロールを会議に出したい場合は将来的な拡張が必要
  （現状はスコープ外、代表1人で十分という判断）。
- `GET /dashboard`の実行中エージェント抽出は`key.split(":")[2]`（キーは
  `` `${sessionId}:${projectId}:${agentId}` ``の3分割なので、agentIdはindex 2）。

## 実装上の注意

- `@anthropic-ai/claude-agent-sdk` は新しいため、AIが存在しないAPIを生成する可能性がある。
  実装前に `node_modules/@anthropic-ai/claude-agent-sdk/*.d.ts` を確認すること。
- 作者はJava経験者でJS/TSは学習中。async/await・React状態管理の説明は厚めに。
- エージェントのプロンプト精度（キャラ付け）の作り込みは意図的に後回し。ツール権限は
  8章の方針通り部署ごとに分離済み（`templates/agents/*.md`の`tools:`で宣言）。
