# 実装計画

## 方針

実装順序は、まず引用付き読書ループを完成させ、その後に Insight Library と AI による段階的コンテキスト拡張を追加し、最後に高度な図解を積み上げる。

```text
PDF Import
  ↓
Document Structure / Search Index
  ↓
Selection / Multi Source
  ↓
Codex Chat
  ↓
Citation Robustness
  ↓
Insight Library
  ↓
Progressive Context Expansion
  ↓
Mermaid / Visualization
```

---

## Phase 0: 基盤

- npm workspace / monorepo
- React + TypeScript + Vite
- Node.js + TypeScript
- Tailwind CSS + shadcn/ui
- TanStack Query / Zustand
- SQLite + Drizzle
- Zod
- Vitest / Playwright
- TypeScript strict

完了条件: `npm run dev` で Web / API が起動し strict build が通る。

---

## Phase 1: PDF Import / Reader

- PDF をアプリ管理領域へコピー
- SHA-256 等で fingerprint
- 同一 PDF の再 import 判定
- PDF.js viewer
- Outline / page navigation / zoom / text layer
- PDF page index と printed page label を分離

完了条件: 一般的な 100 ページ超 PDF を安定して読める。

---

## Phase 2: Document Structure / Local Index

- raw / normalized text
- hyphenation / ligature の基本正規化
- physical text span / rect
- DocumentNode
  - heading
  - paragraph
  - list
  - code
  - table-like block
- chapter / section hierarchy
- retrieval unit
- SQLite FTS5 (`unicode61` + `trigram` + substring fallback)

retrieval unit は固定 token chunk を主構造とせず、block 境界を優先し、目安 500〜900 tokens とする。

完了条件: normalized text で全文検索でき、構造推定失敗時も page / block に fallback できる。

---

## Phase 3: Selection / Source Anchor

- PDF text selection
- `quoteRaw` / `quoteNormalized` / rects
- Floating Action
- Source Card
- Source Anchor 永続化
- citation click → scroll + highlight
- 複数 SourceAnchor を 1 Turn に添付
- `user-selection` / `ai-expansion` origin

固定の意味的件数上限は設けず Context Budget で制御する。

完了条件: 複数ページ・複数章の引用を 1 質問に添付できる。

---

## Phase 4: Codex App Server

- `CodexProcessManager`
- stdio JSONL
- initialize / auth / model list
- ChatGPT login
- thread start / resume
- turn start / interrupt
- streaming
- installed Codex version から TypeScript schema 生成

Codex protocol 型は adapter 内へ閉じ込める。

完了条件: ログイン、thread、streaming、interrupt、異常終了復旧が動く。

---

## Phase 5: Deep Dive Chat MVP

- ContextBuilder
- multi-source Source ID
- Context Budget / Source priority
- Context Preview
- Markdown AST renderer
- SourceReference component
- chat persistence
- read-only permission

優先順位:

```text
User question
User-selected sources
所属 paragraph / nearby blocks
AI-expanded sources
conversation summary
old history
```

完了条件: `複数箇所選択 → 質問 → 回答 → 引用クリック → 原文へ戻る` が一連で動く。

ここまでを **Core Reader MVP** とする。

---

## Phase 6: Citation Robustness

- Source ID validation
- prefix / suffix による anchor 再同定
- Turn ごとの source snapshot
- printed page label
- user-selected / AI-expanded の表示区別
- 送信された context の監査表示

完了条件: 誤った Source ID や PDF 再読込でも UI が壊れず、回答根拠を確認できる。

---

## Phase 7: Insight Library

- `InsightArtifact`
- kind: note / report / table / diagram / chart
- `ArtifactVersion`
- `ArtifactBlock`
- Artifact ↔ SourceAnchor: many-to-many
- Block ↔ SourceAnchor: many-to-many
- Artifact ↔ origin Turn provenance
- `インサイトに保存`
- `回答全体を Report として保存`
- Insight list / filter / detail
- Insight → PDF citation jump
- Insight → new Deep Dive
- version history

Report は Markdown の巨大文字列ではなく ordered block とする。

完了条件: Chat を削除しても Insight が残り、各 block から複数の根拠ページへ戻れる。

---

## Phase 8: Progressive Context Expansion

`BookContextGateway` を実装する。

```text
expandSource
readSection
searchBook
readBlocks
```

探索順序:

```text
Explicit Source
  ↓
Nearby Blocks
  ↓
Section
  ↓
FTS5 Book Search
  ↓
必要な本文だけ取得
```

Codex へ read-only tool / MCP として公開できる場合はそれを利用する。具体的接続は installed Codex version で検証する。

直接 tool 接続へ依存せず、fallback として次の orchestration を持つ。

```text
Codex context-request
  ↓
Node Orchestrator
  ↓
BookContextGateway
  ↓
retrieved source
  ↓
Codex continuation
```

完了条件: 必要な場合だけ AI が追加文脈を取得し、その参照履歴・最終引用を UI と Insight に残せる。

ここまでを **Knowledge MVP** とする。

---

## Phase 9: Mermaid

- fenced mermaid parser
- lazy render
- error boundary
- theme
- sequence / UML / ER / state
- Mermaid block → Insight 保存

---

## Phase 10: React Visualization DSL

- Zod schema
- comparison
- flow: `@xyflow/react`
- hierarchy
- timeline
- matrix
- chart: Recharts
  - bar
  - line
  - scatter
- callout
- visualization error boundary

Chart:

```ts
type ChartDataNature = "source" | "derived" | "illustrative";
```

`sourceRefs` と `dataNature` を必須にする。

Sequence は独自 React renderer を作らず Mermaid の責務とする。

---

## Phase 11: UX / Performance

- pane resize / collapse
- keyboard shortcut
- reader position restore
- lazy / virtualized page rendering
- 複数 Deep Dive history
- Insight search / Tag
- Artifact edit / version diff
- feature-level lazy load / bundle分割

主要項目は実装済み。残りはMermaid系large lazy chunkの追加最適化と、大規模PDFでのvirtualization tuning。

---

## Phase 12: Test

### Unit

- normalizer
- ContextBuilder / Budget
- Source parser / locator
- BookContextGateway
- Visualization schema
- Artifact provenance
- Codex JSONL codec

### Integration / E2E

- PDF import
- multi-selection
- chat streaming
- citation jump
- Insight save
- Insight → citation jump
- FTS5 search
- AI context expansion
- artifact versioning
- Mermaid / Visualization

---

## 完了定義

**Core Reader MVP = Phase 0〜6**

> 読書中の局所的な疑問を、複数の選択箇所を明確な根拠として AI に渡し、回答と原文を高速に往復できる。

**Knowledge MVP = Phase 0〜8**

> Deep Dive で得た知識を Chat から切り離した Insight として蓄積でき、必要な場合だけ AI が書籍内の追加文脈を段階的に探索できる。
---

## 実装開始時の追加確定事項

- Fastify を local Node server framework として採用する。
- ArtifactBlock に GroundingKind / GroundingStatus を実装する。
- User edit 後は grounding status を `modified` / `needs-review` に落とす。
- AI expansion は独立 Expansion Budget で自動制御する。
- Conversation Summary は citation source にしない。
- MVP UI は 1 Book Deep Dive、domain schema は cross-book Artifact を許容する。
- 外部 Web retrieval は MVP 対象外。

詳細は `docs/06_design_decisions.md` を参照する。

---

## 実装進捗（2026-08-10）

- Phase 0: 完了。workspace、React/Vite、Fastify、shared schema、SQLite/Drizzle、Vitest/Playwright、ESLint、strict build/typecheckを構築。Node要件は `>=22.13.0`、検証環境は22.23.2。
- Phase 1: 主要実装完了。PDF管理コピー、SHA-256重複判定、PDF.js canvas/TextLayer、既定1ページ表示/連続スクロール切替、manual zoom/fit-width自動追従、前後移動、embedded PDF Outline、semantic heading fallback、bookごとのpage/zoom復元を実装。
- Phase 2: 主要実装完了。raw/normalized text、座標ベースreading order、heading/paragraph/code/table-like block、2段組heuristic、反復header/footer除外、stable block ID、Outline永続化、`unicode61 + trigram + substring fallback` hybrid searchを実装。実在59ページNIST SP 800-207で抽出評価済み。
- Phase 3: 主要実装完了。DOM selection→PDF座標、raw/normalized quote、prefix/suffix、SourceAnchor永続化、複数Source添付、citation jump/highlight、1ドラッグの複数ページselection、physical rect→DocumentBlock best-effort同定を実装。Semantic index失敗時もPhysical SourceAnchor保存を妨げない。
- Phase 4: 完了。Codex binary discovery、stdio app-server、initialize/auth/model list、ChatGPT login、thread start/resume、turn start/interrupt、streaming、read-only/approval never、異常時thread再生成を実装し、実ChatGPT subscriptionで検証済み。
- Phase 5: 完了。ContextBuilder、Source件数固定上限なしのaggregate budget、Source ID、NDJSON streaming、chat provenance、Markdown/GFM renderer、Context Previewを実装。複数Chat作成・切替とbounded Conversation Memoryも追加。Conversation Memoryはcitation sourceにしない。
- Phase 6: 主要実装完了。未知Source ID検証、context snapshot、printed page label、citation jump/highlight、AI-expanded source表示、retrieval audit、Grounding statusを `references-checked / claim-verified / modified / needs-review` に分離。残る重点はPDF差し替え時のanchor再同定強化。
- Phase 7: 主要実装完了。InsightArtifact / immutable Version / ordered Block / provenance、短縮title、Report保存、Mermaid/Visualization構造保存、編集→v2、history、block diff、Tag/filter、Insight→Deep Diveを実装。
- Phase 8: 主要実装完了。`book_expand_source / book_search / book_read_blocks / book_list_sections / book_read_section`、独立Expansion Budget、検索候補と実読取の分離、実読取時のみai-expansion SourceAnchor化、stable S#、audit永続化/UI、model context window連動adaptive budgetを実装。
- Phase 9: 完了。Chat / Insight共通Mermaid parser、lazy renderer、`securityLevel: strict`、error fallbackを実装。任意JSX/JavaScript/HTMLは実行しない。
- Phase 10: 基盤実装完了。Zod allow-list DSL、comparison/flow/hierarchy/timeline/matrix/callout/chart(bar/line/scatter)、`sourceRefs`、chart `dataNature`、React Flow/Recharts rendererを実装。
- Phase 11: 主要項目実装済み。pane resize/collapse、reader位置復元、Insight edit/version diff、複数Chat、feature-level lazy load、画面から離れたPDF Canvas/TextLayerのunrenderを追加。main JSは約0.95MBから約0.20MBまで縮小。Mermaid依存等の500KB超lazy chunkは継続最適化候補。
- Phase 12: Unit/Integrationに加えてPlaywright E2Eを実装。Reader-only E2Eでは120ページPDFの先頭→末尾移動後もCanvas/TextLayer保持数がboundedであることを実Chromeで検証。Live E2Eでは実Codex App Serverを使い、PDF import → ページ跨ぎselection → multi-source Deep Dive → AI追加探索 → citation jump → Insight保存 → Insight編集v2/version historyまで実ブラウザで通過。

### 現在の残課題

1. PDF再取込・差し替え時のSourceAnchor再同定をprefix/suffix + text hash + geometryで強化する。
2. Readerは遠方ページをunrenderし、120ページE2EでCanvas/TextLayer保持数がboundedなことを確認済み。次は500ページ級での実メモリ計測と未訪問ページのplaceholder寸法精度を追加評価する。
3. Mermaid由来の大きい遅延chunkを、利用diagram種別に応じてさらに分割できるか検討する。
4. `claim-verified` を実際に付与する意味的claim verification工程は将来機能として残す（現状は自動付与しない）。


---

## Phase 12: Chrome標準PDF Viewer + WXT Side Panel

状態: **WXT正式実装 / feature parity完了 / Native Messagingオンデマンド起動実装済み。Live E2E・実PDF評価成功。**

- [x] WXT 0.21 + TypeScript + React のManifest V3 Extension workspace
- [x] selection context menu登録
- [x] Chrome標準PDF pluginの実text selection検証
- [x] ExtensionからPDF import/index
- [x] selection text -> page/block/rect再同定API
- [x] Side Panelから実Codex App Server turn
- [x] Progressive Context Expansion / AI-expanded citation
- [x] citation -> Chrome標準PDF `#page=N` + reload
- [x] PDFタブ単位でSource/Thread状態を分離
- [x] 同一選択文の複数候補をSide Panelで解決
- [x] Cookie認証付きHTTP PDFをbrowser sessionで再取得
- [x] Deep Reader Server停止時にNative Messaging Hostからオンデマンド起動
- [x] Side Panel open / PDF captureの双方から `ensure-server` を実行
- [x] Native Hostはdaemon/Login Itemを作らず、既存production Server controllerを再利用
- [x] 固定Extension ID + Native Host `allowed_origins` の初回登録スクリプト
- [x] Native Messaging framingからServer healthまでの実機テスト
- [x] Chrome Extension → Native Messaging → Server起動のHeadless E2E（停止状態・冪等ensure）
- [x] 自動起動失敗時はSide Panelへ原因を表示
- [x] WXT production buildをroot `npm run check`へ統合
- [x] local `file://` PDF経路
- [x] self-contained `npm run e2e:extension:live`
- [ ] macOSネイティブcontext menuの実ユーザー1クリックsmoke
- [x] ambiguous selection candidate選択UI
- [x] React Side PanelへSources / Chat streaming / citation / Insight保存・一覧・詳細を移植
- [x] 実書籍複数冊でextension経路を評価（NIST SP 800-207 / SP 800-218）
- [x] Markdown / Mermaid / Visualization rich renderer（sanitize / strict / Zod allow-list）
- [x] Insight編集 → immutable v2 / version history / diff
- [x] 複数Chat作成・切替UI
- [x] Progressive Context Expansion retrieval audit UI
- [ ] ネイティブcontext-menuの実ユーザー1クリックsmoke後、Chrome利用時の標準Viewer経路を既定化

独自PDF.js Readerはcutover完了まで削除しない。
