# 技術書深掘りリーダー

技術書 PDF を「全部 AI に渡す」のではなく、**読んでいて気になった箇所だけを選択し、その箇所を根拠に深掘りする**ためのローカル読書ツールです。

## 目標

- PDF を通常の読書ビューアとして快適に読む
- 深掘りしたい本文をマウスで選択し、その選択範囲をチャットの主要コンテキストにする
- 1 回の質問に複数の参照箇所を添付できる
- 必要な場合だけ AI が前後文脈・同一 Section・書籍内検索へ段階的に参照範囲を広げる
- 回答から元 PDF の引用箇所へ即座に戻れる
- Mermaid に加え、安全な構造化データから React コンポーネントの図解・グラフを動的表示する
- チャットから得られたレポート、表、図解、グラフを `Insight Artifact` としてチャットとは独立して保存する
- Insight と PDF のページ・選択本文・AI が追加参照した本文を追跡可能にする
- AI バックエンドは `codex app-server` を利用し、ChatGPT ログインによる Codex のサブスクリプション利用を前提にする
- PDF 全文を毎回プロンプトへ投入せず、コンテキスト量と引用の煩雑さを抑える

## 中心となる3概念

```text
SourceAnchor   原文の根拠
Deep Dive      考えるための対話
Insight        残すための知識成果物
```

Chat は一時的な思考・探索の場とし、書籍から長期的に残したい知識は Insight Library に保存します。

## 想定 UI

```text
┌──────────────┬─────────────────────────────┬─────────────────────────────┐
│ 目次 / 検索   │ PDF Reader                  │ Deep Dive Chat              │
│ Insights     │                             │                             │
│              │ 本文                        │ 選択引用                     │
│ 第1章         │ ┌───────────────────────┐   │ ┌───────────────────────┐   │
│  1.1 ...     │ │ 選択した本文            │   │ │ p.80 / p.83           │   │
│  1.2 ...     │ └───────────────────────┘   │ └───────────────────────┘   │
│ 第2章         │                             │ 回答                         │
│              │                             │ Mermaid / 図解 / グラフ      │
│              │                             │ [Insightに保存]              │
│              │                             │ 質問入力                     │
└──────────────┴─────────────────────────────┴─────────────────────────────┘
```

## 技術スタック

- TypeScript
- React
- Vite
- Node.js（ローカルバックエンド）
- PDF.js (`pdfjs-dist`)
- `codex app-server`（stdio 接続）
- Tailwind CSS + shadcn/ui
- Mermaid
- React Flow (`@xyflow/react`)
- Recharts
- Zod
- TanStack Query
- Zustand
- SQLite + Drizzle
- SQLite FTS5 (`unicode61` + `trigram` hybrid search)
- Vitest + Playwright

## 実行要件

- Node.js **22.13.0 以上**
- このリポジトリで検証済みの Node は `22.23.2`（`.node-version` に固定）
- ChatGPT/Codex のローカル認証済み環境（Live E2E時）

Node 22.12.0 では現在の `pdfjs-dist` / native SQLite 依存との組み合わせで不整合が起きるため、22.13.0 未満はサポートしません。

`codex app-server` 自体の WebSocket transport は実験扱いのため、ブラウザから直接接続しません。Node 側から stdio transport で接続し、Web UI とはアプリ独自の HTTP / WebSocket API で通信します。

## 可視化方針

- Mermaid: sequence / UML / ER / state 等の自由度が必要な図
- `@xyflow/react`: ノード・エッジ型の flow
- Recharts: bar / line / scatter 等の定量グラフ
- Custom React: comparison / hierarchy / timeline / matrix / callout
- AI が生成した任意 JSX / JavaScript は実行しない
- Visualization DSL は Zod で検証する
- Chart は出典由来・計算値・説明用仮想値を区別する

## コンテキスト方針

PDF は固定長 chunk だけで扱わず、次を保持します。

```text
PDF physical layer
  page / text span / rect

Semantic document layer
  chapter / section / heading / paragraph / code / list / table-like block

Retrieval layer
  local search unit
```

AI はユーザーが選択した SourceAnchor から開始し、不足する場合だけ前後 block、Section、書籍内検索へと段階的に広げます。

初期検索は SQLite FTS5 を使い、Latin系は `unicode61` + BM25、日本語/CJK部分一致は `trigram` と短語substring fallbackを組み合わせます。Embedding / vector search は MVP には入れません。

## ドキュメント

- [製品仕様](docs/01_product_spec.md)
- [アーキテクチャ](docs/02_architecture.md)
- [UI・可視化仕様](docs/03_ui_and_visualization.md)
- [実装計画](docs/04_implementation_plan.md)
- [Insight Library・参照モデル・コンテキスト拡張仕様](docs/05_insights_and_context_retrieval.md)
- [実装前設計決定](docs/06_design_decisions.md)
- [自己レビュー改善計画](docs/07_review_remediation_plan.md)
- [Chrome標準PDF Viewer + Side Panel評価](docs/08_chrome_pdf_extension_evaluation.md)
- [Release Security / Chrome Permission Review](docs/09_release_security_and_permissions.md)

## 現在の状態

Core Reader / Knowledge MVP の主要経路は実装済みです。Chrome向けには **WXT + React の正式Extension workspace** を実装し、Chrome標準PDF Viewer + Side Panelを推奨経路とします。

Chrome Extensionは、context menu操作時にSide Panelをuser gesture中に即時openし、その後でPDF import/index・selection再同定を非同期実行します。同一tabで別PDFへ移動した場合はSource / thread / assistant等のdocument-bound stateをresetし、Codex streamingやdraft等の一時UI stateもtab単位で分離します。captureはAbortController・timeout・世代IDで管理し、古い非同期処理が新しいPDF stateを上書きしないようにしています。

標準Viewerの実選択、PDF import/index、selection再同定、複数PDF tab状態分離、同一tab PDF切替、Cookie認証PDF、file:// PDF、実Codex App Server、AI追加参照、citationから標準Viewerの対象ページへ戻る処理、Insight保存/編集v2、複数Deep Dive、Server障害表示まで **Chrome HeadlessのLive E2E** で成立しています。独自Readerはstandalone/fallbackとして当面保持します。

実 Codex App Server を使う Playwright Live E2E では、次の一連の操作をブラウザから検証します。

```text
PDF import
  → 4ページを索引・Outline表示
  → p.1→p.2をまたぐ1つのSourceAnchorを作成
  → 複数SourceでDeep Diveを送信
  → 実 codex app-server / ChatGPT subscription で回答
  → book_search / book_read_blocks / book_expand_source / section tools
  → AI追加参照を SourceAnchor 化
  → [S#] citation から PDF へジャンプ
  → 回答を Insight Report として保存
  → Insightを編集してv2作成・modified確認
  → version history / 根拠ページを確認
```

`gpt-5.6-sol` 等の選択モデルが一時的に capacity の場合は、回答・retrieval がまだ始まっていないときに限り、利用可能な別モデルへ自動 fallback します。モデル出力の tool 引数はアプリ側の Expansion Budget に clamp し、書籍探索が無制限にならないようにしています。

### 普段使い（production）

配布はChrome Web Storeではなく **GitHub Releases** を前提にします。現時点の開発ツリーでは、Chromeに `apps/chrome-extension/.output/chrome-mv3` を一度だけ「パッケージ化されていない拡張機能」として読み込みます。日常利用ではWXT dev serverも、Macログイン時のServer常駐も不要です。

初回セットアップ時だけproduction buildとNative Messaging Hostの登録を行います。

```bash
# 初回・コード更新時
npm run build

# 初回、およびExtension ID/配置を更新したとき
npm run native-host:install

# 登録状態の確認
npm run native-host:status
```

以後は、Deep Reader Side Panelを開くかPDFの選択メニューからDeep Readerを使った時点で、Extensionが `http://127.0.0.1:4317/api/health` を確認します。Serverが停止していればChrome Native Messaging経由で `com.deepreader.launcher` を起動し、既存のproduction Server controllerを使ってDeep Reader Serverをオンデマンド起動します。Server起動時にはランダムなlocal capability tokenを生成し、Native Messaging経由でExtensionへ渡します。`/api/health`以外のproduction APIはこのtokenを持つExtensionからのみ利用できます。

```text
Deep Readerを使う
  → health check
  → 停止中ならNative Messaging Host起動
  → Deep Reader Server起動 / 保護状態確認
  → Native Hostからsession capabilityを取得
  → health確認
  → Bearer capability付きで通常利用
```

Native HostはdaemonでもLogin Itemでもなく、Chromeから必要なときだけ起動される薄いlauncherです。Serverの手動操作は診断用途として引き続き利用できます。

```bash
npm run server:status
npm run server:start
npm run server:stop
npm run server:restart
```

`server:start` は `apps/server/data` を永続データ領域、`apps/server/drizzle` をmigrationとして自動設定し、ChatGPT.app同梱のCodex CLIも自動検出します。Serverは `http://127.0.0.1:4317/api` で待ち受け、ログは `.runtime/server.log` に保存されます。production controllerはcapability tokenを `.runtime/capability-token` にowner-onlyで保持し、Extension側は `chrome.storage.session` にだけ保持します。

### 検証コマンド

```bash
npm run check
npm run e2e:reader
npm run e2e:live
npm run e2e:extension:live
npm run e2e:extension:real -- /path/to/book.pdf
npm run test:native-host
npm run e2e:extension:native-startup
npm run doctor:extension
```

`test:native-host` はNative Messagingのstdio framingからServer healthまでを直接検証し、`e2e:extension:native-startup` は停止中ServerをChrome ExtensionからHeadlessでオンデマンド起動できることと二重ensureの冪等性を検証します。`e2e:reader` は120ページPDFで、遠方ページのCanvas/TextLayerが解放されることを実Chromeで確認します。`e2e:live` は独自Reader経路です。`e2e:extension:live` と `e2e:extension:real` は **Headlessを既定** とし、実インストール済みChrome + WXT production build + Chrome標準PDF Viewer + Side Panelを画面表示なしで検証します。Live E2EはローカルのChatGPT/Codex認証を実際に利用します。

明示的な目視診断が必要な場合だけ、次のようにheadedで起動できます。通常のE2Eでは使用しません。

```bash
DEEP_READER_E2E_HEADLESS=0 npm run e2e:extension:live
```

Chrome Extension開発時は `npm run dev:chrome` でローカルServerとWXT dev serverを同時起動できます。ネイティブcontext menuそのもののクリックはOSのAccessibility/TCC境界があるため、自動Headless E2Eとは分離した最終ユーザースモーク対象です。


## Security / Privacy / License

- Security policy: [SECURITY.md](SECURITY.md)
- Privacy policy: [PRIVACY.md](PRIVACY.md)
- License: [Apache License 2.0](LICENSE)
- Production dependency notices: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)

第三者ライセンス一覧は `npm run licenses:generate` で現在のproduction dependency treeから再生成できます。

### アイコン生成

公開用アイコンの編集原本はリポジトリ直下の `Icon.png` です。Chrome用・GitHub Release用のPNGは手修正せず、次のコマンドで再生成します。

```bash
npm run icons:generate
```

生成先は次のとおりです。

- Chrome Extension: `apps/chrome-extension/public/icons/icon-{16,32,48,128}.png`
- Release / repository artwork: `assets/release/deep-reader-icon-{256,512,1024}.png`

生成時に元画像の黒い外周マットを透明化し、各サイズへ高品質に縮小します。manifestの `icons` / `action.default_icon` はこの生成物を参照します。
