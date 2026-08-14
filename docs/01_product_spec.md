# 製品仕様

## 1. 製品コンセプト

本ツールは、技術書 PDF を読みながら、**その場で選択した箇所を主要根拠として AI に深掘り質問でき、得られた知識を Insight として蓄積できるローカル読書環境**を提供する。

通常の「PDF 全文を AI に渡して質問する」方式では、質問と無関係な情報までコンテキストが膨らみやすく、読書上の焦点と引用位置も失われやすい。

本ツールでは次の 3 概念を中心にする。

```text
SourceAnchor   原文の根拠
Deep Dive      考えるための対話
Insight        残すための知識成果物
```

---

## 2. 基本ユースケース

### 2.1 PDF を読む

Chrome利用時はChrome標準PDF Viewer + WXT/React Deep Reader Side Panelを推奨経路とし、標準Viewerの検索、拡大縮小、ページ表示、印刷、ダウンロード、キーボード操作を利用する。独自PDF.js Readerはstandalone / fallbackとして保持する。

- HTTP/HTTPSまたはローカル PDF を開く
- Chrome標準ViewerではChromeのOutline / thumbnail / search / page navigationを利用する
- standalone版では既定の1ページ表示、連続スクロール切替、拡大縮小、幅合わせ、本文検索を提供する
- 読書位置は各閲覧経路で可能な範囲で保持する

### 2.2 本文を選択して深掘りする

- PDF 本文を選択
- `深掘り` または `引用に追加`
- Source Card を生成
- 質問を入力して Codex に送る
- 質問省略時は「この箇所を詳しく説明して」を既定意図とする余地を持つ

### 2.3 複数箇所を参照する

1 Turn に複数 SourceAnchor を添付できる。

- 同一ページ
- 別ページ
- 別章

を混在可能とする。

参照数に意味的な固定上限は設けず Context Budget で制御する。

### 2.4 回答から原文へ戻る

AI 回答内の Source reference をクリックすると該当 PDF 箇所へジャンプする。standalone Readerでは保存rectを一時ハイライトする。Chrome標準Viewer経路では公開APIに依存できる範囲に限定し、初期版は対象ページへのジャンプを保証する。

### 2.5 必要な場合だけ AI が参照を広げる

AI はユーザーが選択した SourceAnchor だけで十分なら追加検索しない。

不足している場合のみ次の順序で Progressive Context Expansion を行える。

```text
User-selected Source
  ↓
Nearby Blocks
  ↓
Section
  ↓
Book Search
  ↓
必要な本文だけ取得
```

AI が追加取得した Source は user-selected source と区別し、UI と履歴に残す。

### 2.6 Insight を保存する

チャットで得られた説明・レポート・表・図・グラフはチャットセッションと独立した `InsightArtifact` として保存できる。

初期 kind:

- note
- report
- table
- diagram
- chart

1 Insight は複数 SourceAnchor を参照できる。

Report は複数 block から構成し、block ごとに SourceAnchor を紐付ける。

---

## 3. PDF と SourceAnchor

SourceAnchor は単なる文字列ではなく、PDF 上で再現可能な根拠として保存する。

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

- `quoteRaw`: 表示・highlight 用
- `quoteNormalized`: AI送信・検索用

PDF internal page と printed page label は分離する。

---

## 4. PDF 読込時の構造

PDF を固定長 chunk だけに分割しない。

```text
Physical layer
  page / text span / rect

Semantic layer
  chapter / section / heading / paragraph / list / code / table-like block

Retrieval layer
  local search unit
```

retrieval unit は paragraph 等の block 境界を優先して作る。

初期検索は SQLite FTS5 を使用する。Latin語は `unicode61`、CJK部分一致は `trigram`、短いCJK語は substring fallback を併用し、Embedding / vector search は MVP には入れない。

---

## 5. コンテキスト方針

PDF 全文を毎 Turn 自動投入しない。

優先順位:

```text
1. User question
2. User-selected SourceAnchors
3. Source が属する paragraph / nearby blocks
4. AI-expanded Source
5. Conversation summary
6. Older history
```

何を AI に送ったか Context Preview で確認可能にする。

---

## 6. チャット

### 6.1 AI バックエンド

- `codex app-server`
- Node.js local server が app-server process を管理
- stdio JSONL transport
- ChatGPT login による Codex subscription 利用
- App Server protocol は adapter 層へ閉じ込める

### 6.2 Thread

- 1 Book に複数 Chat
- local chat と Codex Thread ID を対応付ける
- thread start / resume
- turn start / interrupt
- streaming

### 6.3 権限

通常読書モードは read-only とする。

書籍内追加参照は `BookContextGateway` という read-only interface へ分離する。

Codex へ tool / MCP として接続できる場合は利用し、利用できない場合も structured retrieval loop で同等の Progressive Context Expansion を実現できる設計にする。

---

## 7. Insight Library

Insight は Chat と別ライフサイクルで保存する。

原則:

- Chat を削除しても Insight は残す
- Insight が参照する SourceAnchor は保持する
- origin Turn を provenance として保持する
- Insight 編集は versioning する
- Artifact と SourceAnchor は many-to-many
- ArtifactBlock と SourceAnchor も many-to-many

Insight Library では種類、Chapter / Section、Page、Tag、更新日時等で絞り込める。

Insight から PDF 原文へ戻り、その Insight を起点に新しい Deep Dive を開始できる。

---

## 8. 可視化

### 8.1 Mermaid

Mermaid は自由度の高い diagram を担当する。

- sequence
- UML / class
- ER
- state
- flowchart 等

### 8.2 React Visualization DSL

AI が任意 JSX / JavaScript を生成・実行する方式は採用しない。

構造化 JSON を Zod で検証し、許可済み React component へ変換する。

初期対応:

- comparison
- flow (`@xyflow/react`)
- hierarchy
- timeline
- matrix
- chart (Recharts)
- callout

Sequence の独自 React renderer は持たず Mermaid に寄せる。

### 8.3 Chart

Chart DSL は `type: "chart"` + `chartType` とする。

```ts
interface ChartVisualization {
  type: "chart";
  chartType: "bar" | "line" | "scatter";
  title: string;
  sourceRefs: string[];
  dataNature: "source" | "derived" | "illustrative";
}
```

仮想値を実測値に見せない。

---

## 9. ローカル保存

SQLite + Drizzle を使用する。

PDF は DB BLOB にせずアプリ管理領域へコピーする。

同一 PDF は fingerprint で判定し、同一内容の再 import では既存 Book を開く。改訂版は別 Book とする。

保存対象:

- Book metadata
- PDF file
- page / text span
- DocumentNode
- retrieval index
- SourceAnchor
- Chat / Turn
- Turn sources
- Insight / versions / blocks
- Artifact sources / provenance
- UI state

---

## 10. 採用技術

- TypeScript
- React
- Vite
- Node.js
- `pdfjs-dist`
- `codex app-server`
- Tailwind CSS + shadcn/ui
- Mermaid
- `@xyflow/react`
- Recharts
- Zod
- TanStack Query
- Zustand
- SQLite + Drizzle
- SQLite FTS5
- Vitest + Playwright

---

## 11. 初期版の対象外

- OCR が必要なスキャン PDF
- EPUB
- クラウド同期
- 複数ユーザー
- 任意 Web ページ取り込み
- 任意 JSX / JavaScript 実行
- 通常読書モードからの shell / file write
- Embedding / vector search

これらは Core / Knowledge MVP 成立後に必要性を再評価する。
---

## 12. Grounding・編集・複数書籍に関する確定仕様

- AI 出力 block は `source-backed` / `derived` / `ai-explanation` の GroundingKind を持てる。
- Insight block は `references-checked` / `claim-verified` / `modified` / `needs-review` の GroundingStatus を持つ。参照ID確認と意味的な主張検証は分離し、ユーザー編集後は根拠整合性を自動保証しない。
- MVP では外部 Web 検索を行わず、AI 一般知識による補足は PDF 根拠と明確に区別する。
- AI の Progressive Context Expansion は都度確認なしで自動実行できるが、User-selected Source を保護した独立 Expansion Budget で制御する。
- Conversation Summary は会話継続専用であり、SourceAnchor・Insight の citation source にはしない。
- MVP UI の Deep Dive は 1 冊単位だが、Insight のデータモデルは複数 Book の SourceAnchor を参照可能とする。
- 詳細は `docs/06_design_decisions.md` を正本とする。
