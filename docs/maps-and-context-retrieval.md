# Maps・参照モデル・コンテキスト拡張仕様

## 1. 目的

Lensmapでは、Exploreの会話ログそのものを最終成果物としない。

ユーザーが注目した一節・図表を起点に文脈を広げ、得られた理解を **MapArtifact** として自動保存する。MapArtifactは、Threadを読み直さなくても内容を再構築できる、視覚的かつ根拠付きの知識成果物である。

基本原則:

1. ユーザーが選択したText / Visual Sourceを最優先の根拠とする。
2. 1 Turn・1 MapArtifactは複数BookのSourceAnchorを参照できる。
3. AIが追加で読んだ箇所は追跡可能にする。
4. Explore履歴とMapArtifactは別ライフサイクルで管理する。
5. MapArtifactは回答ログのコピーではなく、理解の構造が見える形で保持する。
6. AIへPDF全文を一括投入せず、必要な文脈だけ段階的に広げる。
7. 図解が有効ならvisualを積極利用するが、diagramを強制しない。

上位原則は [`concept.md`](concept.md) を正とする。

関連する設計判断: [`ADR-001: Structured Map Composition`](adr/ADR-001_structured-map-composition.md)

---

## 2. 主要ドメイン

```text
ReaderWorkspace
 ├─ Documents
 │   └─ Book *
 │       ├─ DocumentNode
 │       └─ SourceAnchor *
 ├─ Explore Threads
 │   └─ Turn *
 └─ MapArtifact *
     └─ MapVersion *
         └─ MapBlock *
```

`ReaderWorkspace` が読書テーマの所有単位であり、BookはWorkspaceにmany-to-manyで所属できる。Chrome TabはPDFを読む・Focusをcaptureする・Evidenceから原文へ戻るためのSurfaceであり、ExploreやMapの所有者ではない。

### 2.1 Focus / SourceAnchor

ユーザー向けには `参照` / `選択箇所` / `図表` と表現し、内部domainでは `SourceAnchor` を使う。

```ts
type SourceAnchor = TextSourceAnchor | VisualSourceAnchor;
```

Text Source:

```ts
interface TextSourceAnchor {
  id: string;
  kind: "text";
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

Visual Source:

```ts
interface VisualSourceAnchor {
  id: string;
  kind: "visual";
  bookId: string;
  imageAssetId: string;
  captureRectNormalized: NormalizedRect;
  locationStatus: "unresolved" | "page-resolved" | "rect-resolved";
  page?: number;
  pageRectNormalized?: NormalizedRect;
  locationConfidence?: number;
  recognizedText?: string;
  ocrConfidence?: number;
  origin: "user-selection" | "ai-expansion";
  documentNodeIds: string[];
}
```

Visual Sourceではcrop画像そのものが一次情報であり、OCR / page / rect / descriptionは派生metadataである。詳細は [`visual-source-capture.md`](visual-source-capture.md) を参照する。

---

## 3. Explore Turnと複数参照

1回の質問に複数SourceAnchorを添付できる。Bookを跨いでよい。

```text
Explore Turn
 ├─ S1 · Book A · p.80 · Text
 ├─ S2 · Book A · p.83 · Visual
 ├─ S3 · Book B · p.121 · Text
 └─ User question
```

参照件数に製品上の固定上限を設けず、Context Budgetで制御する。

優先順位:

```text
1. User question
2. User-selected Sources
3. Source周辺のDocumentNode
4. AIが追加取得した高関連Source
5. Nearby context
6. Conversation summary
7. Older conversation history
```

ユーザーが明示したSourceをAI自動探索結果が押し出さない。

---

## 4. MapArtifact

### 4.1 定義

`MapArtifact` はExploreの正常完了時に自動保存されるdurable outcomeである。

最低条件:

1. **One idea** — titleから何を理解するMapか分かる。
2. **Structured** — 会話ログではなく、関係・比較・順序・要点が整理されている。
3. **Visual where useful** — 図解が有効ならdiagram / table / chart等を含む。
4. **Grounded** — 根拠Sourceを保持する。
5. **Traceable** — Evidenceから元PDFへ戻れる。
6. **Reusable** — Explore Threadを開かなくてもMap単体で意味が分かる。
7. **Versioned** — 編集しても由来と変更履歴を失わない。

### 4.2 Mapの意味分類と表示形式を分離する

旧来の `note / report / table / diagram / chart` をMapArtifact自体の種類にはしない。これらは表示形式である。

一方、Mapが「何を理解した成果物か」は意味分類として保持する。初期の `MapSemanticKind` は次とする。

```ts
type MapSemanticKind =
  | "definition"
  | "comparison"
  | "causal"
  | "process"
  | "hierarchy"
  | "timeline"
  | "quantitative"
  | "synthesis";
```

例えば `definition` Mapは文章中心のdefinition cardでもよく、`comparison` Mapは単純なtableだけでもよい。Mapの意味とReactでの表現を同一視しない。

1つのMapは複数の表現を組み合わせる。

```ts
interface MapArtifact {
  id: string;
  workspaceId: string;
  title: string;
  preview: string;
  latestVersionId: string;
  createdAt: string;
  updatedAt: string;
}

interface MapVersion {
  id: string;
  mapId: string;
  semanticKind: MapSemanticKind;
  primaryBlockId: string | null;
  conciseExplanation: string;
  blocks: MapBlock[];
  provenance: MapProvenance;
  createdAt: string;
}
```

`MapBlock`:

```ts
type MapBlock =
  | NarrativeBlock
  | DefinitionBlock
  | CalloutBlock
  | TableBlock
  | DiagramBlock
  | ChartBlock
  | VisualReferenceBlock;
```

通常文章は一続きのDocumentとして表示し、内部的なMarkdown chunkをそのままカード列にしない。

### 4.3 Structured form / Visual form

構造化できる理解は回答生成時点で構造化する。表示が文章中心でも、内部まで非構造化テキストに戻さない。

```text
definition      → definition structure → definition card / concise text
comparison      → comparison structure → table / comparison
causal          → relation structure   → flow
process         → ordered relation     → flow / ordered steps
hierarchy       → parent-child         → hierarchy / outline
timeline        → temporal items       → timeline
quantitative    → numeric structure    → table / chart
synthesis       → mixed blocks         → structured narrative +必要なblock
```

`@lensmap/visualization` のallow-list JSONをReact-renderable structured blockとして利用し、`definition` と `table` も第一級schemaへ追加する。Mermaidは、structured JSONで自然に表せない図のescape hatchとして残す。

ユーザーへMermaidや内部JSON DSLを選ばせない。

### 4.4 Provenance

```ts
interface MapProvenance {
  originTurnIds: string[];
  sourceAnchorIds: string[];
  createdBy: "ai" | "user" | "mixed";
  createdAt: string;
}
```

MapVersion全体とMapBlock単位の両方でSourceAnchorを追跡できるようにする。

保存原則:

- Explore Threadを削除してもMapArtifactは消さない。
- MapArtifactが参照するSourceAnchorは保持する。
- `originTurnId` を保持する。
- 編集時は既存versionを上書きせず、新しいMapVersionを作る。
- MapのBook集合はSource provenanceから導出し、単一`primaryBookId`をauthorityにしない。

---

## 5. Map自動保存

正常に完了したAssistant responseは、ユーザー操作なしでMapArtifactとして保存する。

```text
Explore response / Map Draft completes
        ↓
MapVersion materialization
        ↓
MapArtifact persistence
        ↓
Maps library cache refresh
```

要件:

- `originTurnId` で冪等化する。
- retry / reloadで重複Mapを作らない。
- Map保存失敗はExplore回答自体を失敗扱いにしない。
- 保存失敗時だけ非破壊なretry actionを出す。
- 通常フローに手動保存・手動昇格ボタンを置かない。
- 完了後は静かに `Mapに保存済み` と表示し、必要なら `Mapsで開く` を出す。

Mapは回答文字列の単純コピーではない。CodexはLensmap専用Map Composition Skillを利用し、成功Turnでは可能な限りstructured Map Draftを生成する。Local Serverはclient-provided `lensmap_compose_map` dynamic toolでDraftをZod検証し、Turn完了時にMapArtifactへmaterializeする。Draftが得られない場合だけ既存Markdown解析をfallbackとして使う。Map自動保存方針は変えない。

---

## 6. Maps UI

Workspaceごとに `Maps` Surfaceを持つ。

```text
Explore | Maps
```

### 6.1 Maps list

Map cardの優先情報:

```text
[visual thumbnail / preview]
Title
2〜3行 preview
Referenced books / pages
Updated time
```

内部のblock kind、renderer名、version番号、`needs-review`等を主要metadataとして表示しない。

### 6.2 Map detail

表示優先順:

1. title
2. primary visual understanding
3. concise explanation
4. Evidence
5. version / edit history

Evidenceは折りたたみ可能だが、Mapから常に到達できる。

### 6.3 Editing

初期版では自由Canvasを作らない。

編集対象:

- title
- concise explanation
- visual block再生成
- visual form変更
- source inclusion / exclusion
- block順序

編集は新しいMapVersionとして保存する。

---

## 7. Grounding

内部的には次を区別する。

```ts
type GroundingKind = "source-backed" | "derived" | "ai-explanation";
type GroundingStatus =
  | "references-checked"
  | "claim-verified"
  | "modified"
  | "needs-review";
```

`references-checked` はSource IDが実在し解決できることだけを意味する。意味的な根拠一致を別工程で検証した場合だけ `claim-verified` とする。

通常UIでは `needs-review` を「要確認」と表示しない。必要なら意味を具体化する。

例:

- `書籍本文の直接引用を伴わないAI補足`
- `編集済み · 引用は元回答時点の根拠`

---

## 8. PDF読込時の構造化

固定長token chunkを主構造にはしない。

```text
Layer 1: Physical
  page / text span / rect

Layer 2: Semantic
  chapter / section / heading / paragraph / list / code / table-like block

Layer 3: Retrieval
  search unit / retrieval chunk
```

### 8.1 Physical layer

`pdfjs-dist`のtext itemと座標を保持し、Text Sourceの再同定とVisual Sourceの位置解決に利用する。

### 8.2 Semantic layer

可能な範囲でPDF Outline、フォントサイズ、位置、余白、行間等を利用しDocumentNodeを構成する。完全復元に失敗してもpage / block順序は保持する。

### 8.3 Retrieval layer

- paragraph / code / list等を基本単位とする。
- 短いblockは隣接blockと束ねる。
- 目安500〜900 tokens。
- overlapは固定token重複より前後blockを優先する。

Retrieval unitは引用元そのものではない。検索hitから元DocumentNode / PDF spanへ再接続してSourceAnchorを作る。

---

## 9. Progressive Context Expansion

LensmapのAIは「本を代わりに読む主体」ではなく、Focusに対して必要な範囲だけ視野を広げるLensである。

```text
Explicit Sources
       ↓
Nearby blocks
       ↓
Same section
       ↓
Workspace search
       ↓
Necessary passages only
```

追加探索は「多く読むこと」を目的にしない。質問への理解を改善する意味がある場合に実行し、何を検索し何を実際に読んだかを追跡可能にする。

比較、因果、定義、設計意図、章全体との関係、複数概念の統合では、追加探索が有用なら明示Sourceだけで表面的に答えられる場合でも文脈を広げてよい。

Expansion Budget:

- `maxRounds`
- `maxRetrievedTokens`
- `maxSearchQueries`

具体値はmodel capabilityと実測で調整する。

---

## 10. WorkspaceContextGateway

CodexとPDF indexの間にWorkspace-scoped read-only gatewayを置く。

```ts
interface WorkspaceContextGateway {
  expandSource(input: {
    sourceId: string;
    beforeBlocks?: number;
    afterBlocks?: number;
  }): Promise<SourceCandidate[]>;

  readSection(input: {
    bookId: string;
    sectionId: string;
    maxBlocks?: number;
  }): Promise<SourceCandidate[]>;

  searchWorkspace(input: {
    query: string;
    bookIds?: string[];
    limit?: number;
  }): Promise<SearchHit[]>;

  readBlocks(input: {
    blocks: Array<{ bookId: string; blockId: string }>;
  }): Promise<SourceCandidate[]>;
}
```

書籍内容の取得はread-onlyとし、file write / shell / web search等から分離する。

installed Codex App Serverではclient-provided DynamicTool接続を第一方式とする。アプリdomainはCodex固有protocolへ依存させず、必要ならorchestrator経由のstructured retrieval loopへ置換可能にする。

---

## 11. AI追加参照の監査

Turn単位で次を保存する。

- workspace / target books
- search query
- candidate blocks
- 実際にreadしたblocks
- 画像入力へ渡したVisual Source
- materializeした`ai-expansion` SourceAnchor
- citationへ昇格したSource
- Expansion Budgetによるtruncation

検索候補を見ただけではEvidenceへ昇格させない。

通常UIではraw JSONではなく、例えば次のsummaryを表示する。

```text
3箇所を追加参照
- Book A · p.43 · 前後の文脈
- Book B · p.18 · “consensus”を検索
- Book B · p.21 · 同じ節
```

詳細auditはadvanced/debug Surfaceへ分離する。

---

## 12. 検索方式

初期版:

- Latin / 空白区切り語: SQLite FTS5 `unicode61` + BM25
- 日本語/CJK部分一致: SQLite FTS5 `trigram`
- 3文字未満等: normalized substring fallback
- Book / chapter / section / page metadata filter

Embedding / vector searchは初期版に含めない。

Visual SourceのOCR textは検索補助に利用できるが、画像一次情報を置き換えない。

---

## 13. 永続化モデル

Canonical table names:

```text
reader_workspaces
workspace_books

books
book_pages
document_nodes
retrieval_units
source_anchors
visual_source_assets

explore_threads
explore_turns
turn_sources

map_artifacts
map_versions
map_blocks
map_sources
map_block_sources
map_origin_turns

ui_state
```

主なcardinality:

```text
Workspace * <-> * Book
Workspace 1 -> * ExploreThread
Turn * <-> * SourceAnchor
Workspace 1 -> * MapArtifact
MapArtifact 1 -> * MapVersion
MapVersion 1 -> * MapBlock
MapArtifact * <-> * SourceAnchor
MapBlock * <-> * SourceAnchor
MapArtifact * <-> * Turn (origin/provenance)
```

初回リリース前なので、legacy domain table名との互換aliasを正式schemaには残さない。既存開発DBの扱いは実装計画に従う。

---

## 14. Visualization

MapArtifact / Explore responseは次のrendererを利用できる。

- Markdown / narrative
- definition
- table
- comparison
- flow
- hierarchy
- timeline
- matrix
- callout
- chart (`bar` / `line` / `scatter`)
- Mermaid（structured JSONで自然に表現できない場合のescape hatch）

任意JSX / JavaScript / HTMLは実行しない。Visualization JSONはZod allow-list schemaで検証する。

Chartは `dataNature = source | derived | illustrative` を必須とし、illustrative valueを実測値のように表示しない。

---

## 15. 設計上の結論

Lensmapの中心概念:

```text
Workspace       読書テーマ
Focus / Source  人間が注目した根拠
Explore         理解を掘るLens
MapArtifact     自動的に残る理解の地図
```

Chrome TabやChatは中心domainではない。

AIはFocusから始め、必要な文脈だけExpandし、得られた理解をtraceableなMapとして残す。
