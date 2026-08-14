# Insight Library・参照モデル・コンテキスト拡張仕様

## 1. 目的

本ツールでは、チャットそのものを最終成果物としない。

読書中の対話から得られた説明、比較、レポート、表、図解、グラフ等を、**書籍から得た再利用可能な知識成果物（Insight Artifact）** としてチャットセッションから独立して保存する。

また、ユーザーが明示した参照箇所を起点にしつつ、必要な場合だけ AI が書籍内の追加コンテキストを探索できるようにする。

基本思想は次の通り。

1. ユーザーが選択した箇所を常に最優先の根拠とする。
2. 1 Turn・1 Artifact は複数の参照箇所を持てる。
3. AI が追加参照した箇所もすべて追跡可能にする。
4. チャット履歴と Insight Artifact は別ライフサイクルで管理する。
5. PDF を固定長チャンクだけに分解せず、ページ・段落・見出し・セクション等の構造を保持する。
6. AI に書籍全文を一括投入しない。必要な範囲だけ段階的に広げる。

---

## 2. 主要ドメイン

```text
Book
 ├─ DocumentNode
 │   ├─ Chapter
 │   ├─ Section
 │   ├─ Page
 │   └─ Block
 │
 ├─ SourceAnchor
 │
 ├─ Chat
 │   └─ Turn
 │
 └─ InsightArtifact
     └─ ArtifactVersion
```

### 2.1 SourceAnchor

ユーザーまたは AI が参照した、PDF 上の再現可能な根拠。

```ts
interface SourceAnchor {
  id: string;
  bookId: string;
  pageStart: number;
  pageEnd: number;
  quoteRaw: string;
  quoteNormalized: string;
  prefix?: string;
  suffix?: string;
  rects: PdfRect[];
  textHash: string;
  origin: "user-selection" | "ai-expansion";
  documentNodeIds: string[];
}
```

`quoteRaw` は画面表示・ハイライト再現用、`quoteNormalized` は AI への送信用とする。

---

## 3. 複数参照

### 3.1 Chat Turn

1 回の質問に SourceAnchor を複数添付できる。

```text
Turn
 ├─ S1 p.80
 ├─ S2 p.83
 ├─ S3 p.121
 └─ User question
```

固定の「最大 8 件」を製品上の意味的制限にはしない。

参照数ではなく **Context Budget** で制御する。

- 小さい引用なら多数添付可能
- 長大な引用が多い場合は送信前に警告
- Context Preview で実際に送信される範囲を確認可能
- ユーザーが明示した SourceAnchor は AI が追加探索した SourceAnchor より優先する

実装上、安全のための十分大きな上限値は持ってよいが、UI の概念として「8 件まで」等にはしない。

### 3.2 Insight Artifact

1 Artifact も複数 SourceAnchor を参照できる。

```text
Insight Artifact: 「CDN と Edge の整理」
 ├─ p.80
 ├─ p.83
 ├─ p.121
 └─ AI が追加参照した p.126
```

Artifact と SourceAnchor は many-to-many とする。

---

## 4. Insight Artifact

## 4.1 Artifact の種類

初期対応:

```ts
type InsightArtifactKind =
  | "note"
  | "report"
  | "table"
  | "diagram"
  | "chart";
```

### note

短い Markdown メモ・要点。

### report

複数ブロックから構成される Markdown 中心のまとまった説明。

### table

Markdown table を表示可能にするが、保存時は可能なら構造化 rows / columns も保持する。

### diagram

Mermaid または Visualization DSL による図解。

### chart

Visualization DSL + Recharts による定量グラフ。

---

## 4.2 Report は複合 Artifact とする

Report は単一の巨大 Markdown 文字列だけにしない。

```ts
interface ReportArtifact {
  id: string;
  title: string;
  blocks: ArtifactBlock[];
}

type ArtifactBlock =
  | MarkdownBlock
  | TableBlock
  | DiagramBlock
  | ChartBlock;
```

各 block が独立して `sourceRefs` を持てる。

これにより、レポート全体では複数ページを参照しつつ、各段落・表・図が「どの根拠からできたか」を追跡できる。

---

## 4.3 Artifact の provenance

Artifact には少なくとも次を保持する。

```ts
interface ArtifactProvenance {
  originTurnIds: string[];
  sourceAnchorIds: string[];
  createdBy: "ai" | "user" | "mixed";
  createdAt: string;
}
```

さらに ArtifactBlock 単位でも SourceAnchor と紐付ける。

### 保存原則

- Chat を削除しても Artifact は消さない
- Artifact が参照している SourceAnchor は保持する
- 元となった Turn ID は provenance として残す
- Artifact 編集時は上書きではなく version を作成する

---

## 4.4 ArtifactVersion

Insight は後から修正・統合することがあるため versioning する。

```text
Artifact
 ├─ v1 AI生成
 ├─ v2 ユーザー修正
 └─ v3 別の参照を追加してAI再整理
```

最新版を通常表示し、過去版へ戻れるようにする。

---

## 5. Insight Library UI

書籍ごとに `Insights` ビューを持つ。

```text
[目次] [深掘り] [Insights]
```

Insights では以下を提供する。

- 一覧
- タイトル検索
- 種類 filter
- Chapter / Section filter
- 参照ページ filter
- Tag
- 更新日時順
- Artifact を開く
- Artifact から原文へ戻る
- Artifact から新しい Deep Dive を開始する

チャット回答の各保存可能 block には `インサイトに保存` を表示する。

回答全体を `Report として保存` することもできる。

初期版では全回答を自動保存しない。ノイズを避けるため、**ユーザーが保存したものだけ Insight Library の正式な知識成果物** とする。

---

## 6. PDF 読込時の構造化

固定長 token chunk をドキュメントの主構造にはしない。

PDF 読込時には、少なくとも次の 3 層を生成する。

```text
Layer 1: PDF physical layer
  page
  text span
  rect

Layer 2: semantic document layer
  chapter
  section
  heading
  paragraph
  list
  code block
  table-like block

Layer 3: retrieval index layer
  search unit / retrieval chunk
```

### 6.1 Physical layer

PDF.js の text item と座標を保持する。

目的:

- Selection
- Highlight
- SourceAnchor 再現

### 6.2 Semantic document layer

可能な範囲で PDF Outline、フォントサイズ、位置、余白、行間等を利用し、DocumentNode を構成する。

```ts
interface DocumentNode {
  id: string;
  bookId: string;
  type: "chapter" | "section" | "heading" | "paragraph" | "list" | "code" | "table";
  parentId?: string;
  pageStart: number;
  pageEnd: number;
  textRaw: string;
  textNormalized: string;
  order: number;
}
```

完全な文書構造復元は保証しない。失敗しても page / block の順序関係は必ず保持する。

### 6.3 Retrieval layer

検索用には DocumentNode をまたぐ小さな retrieval unit を別途作る。

推奨初期値:

- paragraph / code / list 等の block を基本単位とする
- 短い block は隣接 block と束ねる
- 目安 500〜900 tokens
- overlap は固定 token 重複ではなく、前後 1 block 程度を優先

重要なのは、retrieval chunk を引用元そのものにしないこと。

検索で chunk がヒットした後、回答へ渡す SourceAnchor は元の DocumentNode / PDF span に再接続する。

---

## 7. AI による段階的コンテキスト拡張

AI はユーザーが選択した箇所だけで十分なら、それ以上書籍を読まない。

不足している場合のみ、次の順序で追加参照を要求できる。

```text
Explicit SourceAnchor
       ↓
同一段落・前後 block
       ↓
同一 Section
       ↓
Book Search
       ↓
必要な hit の本文だけ取得
```

これを **Progressive Context Expansion** と呼ぶ。

### 7.1 BookContextGateway

Codex と PDF index の間に、アプリ固有の read-only gateway を置く。

概念 API:

```ts
interface BookContextGateway {
  expandSource(input: {
    sourceId: string;
    beforeBlocks?: number;
    afterBlocks?: number;
  }): Promise<SourceCandidate[]>;

  readSection(input: {
    sectionId: string;
    maxBlocks?: number;
  }): Promise<SourceCandidate[]>;

  searchBook(input: {
    query: string;
    limit?: number;
  }): Promise<SearchHit[]>;

  readBlocks(input: {
    blockIds: string[];
  }): Promise<SourceCandidate[]>;
}
```

書籍内容の取得は read-only とし、ファイル操作・shell 実行とは分離する。

---

## 7.2 Codex との接続方式

Codex は MCP server 等でツール拡張できるため、最終的には `BookContextGateway` を読書専用 tool として Codex へ公開する方式を第一候補とする。

ただし `codex app-server` の具体的な tool 接続方法は実装時の installed Codex version で検証する。

アプリのドメイン設計は Codex 固有 protocol に依存させない。

そのため、直接 tool call が利用できない場合でも、次の structured retrieval loop で同等機能を実現できる設計にする。

```text
Codex
  ↓ context-request
Node Orchestrator
  ↓ BookContextGateway
PDF index
  ↓ retrieved source blocks
Node Orchestrator
  ↓ continuation
Codex
```

つまり「AI が自分から追加参照する」という製品機能は App Server の単一機能へ依存させない。

---

## 8. 追加参照の可視化

ユーザーが明示した参照と、AI が自分で追加した参照を区別する。

```text
Sources

User selected
  p.80
  p.83

AI expanded
  p.84   前後文脈
  p.126  book search: "edge runtime"
```

AI が追加取得した本文も SourceAnchor として保存し、最終回答で引用したものだけ Turn の citation set に昇格させる。

Insight Artifact 保存時は、Artifact が実際に依拠した SourceAnchor を引き継ぐ。

---

## 9. 検索方式

初期版ではローカル全文検索を使う。

採用方式:

- Latin / 空白区切り語: SQLite FTS5 `unicode61` + BM25
- 日本語/CJK部分一致: SQLite FTS5 `trigram`
- 3文字未満等: normalized text の substring fallback
- chapter / section / page metadata を filter に利用

Embedding / vector search は初期版に入れない。

理由:

1. ローカル読書ツールとして依存が増える
2. 技術用語は lexical search でも十分強い
3. 「選択箇所を起点に必要な範囲だけ読む」という思想をまず検証したい
4. 将来必要になれば retrieval adapter の追加で対応できる

---

## 10. Context Budget

コンテキスト制御は SourceAnchor 件数ではなく token budget を中心に行う。

優先順位:

```text
1. User question
2. User-selected SourceAnchors
3. SourceAnchor が属する段落
4. AI が追加取得した高関連 Source
5. Nearby context
6. Conversation summary
7. Older conversation history
```

ユーザーが明示した引用を、AI の自動探索結果が押し出さないことを保証する。

---

## 11. Artifact と引用の粒度

### Artifact level

Artifact 全体が利用した SourceAnchor の集合。

### Block level

各 Markdown / Table / Diagram / Chart block が利用した SourceAnchor。

### 将来拡張

必要になれば Markdown 内の claim / text range 単位 citation まで拡張可能にする。

MVP では block-level citation までを正式仕様とする。

---

## 12. 永続化テーブル案

```text
books
book_pages
document_nodes
retrieval_units

source_anchors

chats
chat_turns
turn_sources

insight_artifacts
artifact_versions
artifact_blocks
artifact_sources
artifact_block_sources
artifact_origin_turns

ui_state
```

主な cardinality:

```text
Turn * <-> * SourceAnchor
Artifact * <-> * SourceAnchor
ArtifactBlock * <-> * SourceAnchor
Artifact * <-> * Turn (origin/provenance)
```

---

## 13. 採用済み関連技術

- PDF: `pdfjs-dist`
- UI: Tailwind CSS + shadcn/ui
- Markdown: AST ベースの custom renderer
- Mermaid: Mermaid
- Flow / node graph: `@xyflow/react`
- Chart: Recharts
- Visualization validation: Zod
- Server state: TanStack Query
- Reader / transient UI state: Zustand
- DB: SQLite + Drizzle
- Local full-text search: SQLite FTS5 (`unicode61` + `trigram`) + substring fallback
- Test: Vitest + Playwright

Chart DSL は次の形を基本とする。

```ts
interface ChartVisualization {
  type: "chart";
  chartType: "bar" | "line" | "scatter";
  title: string;
  sourceRefs: string[];
  dataNature: "source" | "derived" | "illustrative";
  // axes / series / data ...
}
```

Sequence Diagram は Mermaid の責務とし、React Visualization の独自 `sequence` renderer は持たない。

---

## 14. 設計上の結論

本ツールにおける中心オブジェクトは Chat ではなく、次の 3 つとする。

```text
SourceAnchor   原文の根拠
Deep Dive      考えるための対話
Insight        残すための知識成果物
```

Chat は探索・思考のワークスペースであり、Insight Library が書籍から得た知識の蓄積先となる。

AI は全文を最初から読むのではなく、ユーザーが指定した SourceAnchor から開始し、必要な場合だけ Progressive Context Expansion により書籍内を段階的に探索する。
---

## 15. Grounding と編集後の検証

```ts
type GroundingKind = "source-backed" | "derived" | "ai-explanation";
type GroundingStatus =
  | "references-checked"
  | "claim-verified"
  | "modified"
  | "needs-review";
```

`references-checked` は block 内の Source ID が実在し、SourceAnchor へ解決できることだけを表す。本文の主張が意味的に根拠づけられていることまでは保証しない。意味的一致を別工程で検証した場合だけ `claim-verified` とする。現行MVPは `claim-verified` を自動付与しない。ユーザーが block 本文を編集した場合は、既存 citation を保持しても `modified` または `needs-review` へ遷移させる。

Source数が複数あることだけを理由に `derived` とは判定しない。`derived` は複数根拠からの明示的な推論・計算・統合に使用する。

MVP では外部 Web 検索を行わず、書籍外の補足は `ai-explanation` とする。Conversation Summary は source ではない。

AI の追加参照は自動実行可能とするが、`maxRounds` / `maxRetrievedTokens` / `maxSearchQueries` を持つ Expansion Budget で制御する。具体値は model capability と実測に基づいて実装時に調整する。

MVP の Deep Dive は 1 Book に限定する一方、Artifact と SourceAnchor の関係は Book を跨げる schema とする。


### Codex DynamicTool 接続（実装確定）

installed Codex App Serverで `thread/start.dynamicTools` / `item/tool/call` を実機検証し、直接 DynamicTool 接続を第一方式とする。検索結果だけではSource化せず、実際に読んだblockだけ `ai-expansion` SourceAnchorとして永続化する。


## 16. Codex 読書専用Tool隔離

Deep ReaderのAI追加参照は便利さよりも「何を読ませたかを限定できること」を優先する。単なる `read-only` sandbox だけでは、ユーザーのCodex設定に存在するMCPやAppがmodel-visibleになる可能性があるため、次の多層防御を採用する。

1. App Server process 起動時に Apps / browser / computer use / plugins / shell / unified exec / image generation / multi-agent / skill search 等の非読書featureを `--disable` する。
2. initialize後に `config/read` を行い、MCPのcommand・env・credentialは保持せず**server名だけ**を抽出する。
3. `thread/start.config` で設定済みMCPをすべて `enabled:false`、`web_search: disabled`、App defaultもdisabledにする。
4. thread/turnごとに `approvalPolicy: never` と read-only / network-off を再適用する。
5. AIに公開する追加取得経路は client-provided `book_*` DynamicToolだけに限定する。
6. `code_mode_host` は現行CodexのDynamicTool transportに必要であるためprocess-levelでは維持するが、Deep Readerの業務toolとしては公開しない。

この隔離状態でも DynamicTool が動作することを実 Codex GPT-5.6 Sol でlive smoke済み。


## 17. AI追加参照の監査

検索query・候補block・実読取block・割り当てたS#・Expansion BudgetによるtruncationをTurn単位で保存する。**実際に AI が読んだ追加文脈だけ**をChatMessage Sourceとして永続化し、UIでは「AI追加参照」としてユーザー選択Sourceと区別する。Insightへ保存するときは、Artifact Block内で実際に参照されたS#だけをBlock provenanceとして採用し、検索候補だけだった箇所は根拠に昇格させない。
