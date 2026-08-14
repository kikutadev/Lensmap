# 実装前設計決定

本書類は、実装開始前に残っていた仕様上の未決事項について採用方針を固定する。

## 1. Grounding model

AI 出力は、書籍との関係を block 単位で区別する。

```ts
type GroundingKind =
  | "source-backed"
  | "derived"
  | "ai-explanation";

type GroundingStatus =
  | "references-checked"
  | "claim-verified"
  | "modified"
  | "needs-review";
```

- `source-backed`: SourceAnchor に直接裏付けられる説明。
- `derived`: Source数ではなく、明示的な推論・整理・計算として扱う。複数Sourceがあるだけでは `derived` にしない。
- `ai-explanation`: 書籍外の一般知識による補足。
- MVP では外部 Web 検索を行わない。将来追加する場合は Web source を SourceAnchor とは別の source type として扱う。

`references-checked` は Source ID の存在・対応だけを確認した状態であり、主張内容がSource本文で意味的に裏付けられたことを意味しない。意味的一致まで検証した場合だけ `claim-verified` とする。ArtifactBlock をユーザーが編集した場合は `modified` または `needs-review` に遷移する。

## 2. Progressive Context Expansion

AI による追加参照は、ユーザーへの都度確認なしで自動実行できる。ただし User-selected Source を保護する Context Budget とは別に Expansion Budget を設ける。

概念上の予算:

```ts
interface ExpansionBudget {
  maxRounds: number;
  maxRetrievedTokens: number;
  maxSearchQueries: number;
}
```

具体値は利用モデルの context 能力と実測に基づき実装時に決定する。探索履歴は UI から確認できるようにする。

## 3. Conversation summary

Conversation Summary は会話継続のための圧縮状態であり、根拠ではない。

- SourceAnchor として保存しない。
- Insight の citation source にしない。
- Summary の内容を根拠として `source-backed` を付与しない。

## 4. Multiple books

MVP の Deep Dive UI は現在開いている 1 冊を対象にする。

一方、ドメインモデルは最初から複数 Book の SourceAnchor を 1 Artifact が参照できるようにする。将来の Library 横断 Deep Dive を schema migration なしで追加できることを目標とする。

## 5. PDF structure extraction

PDF の semantic structure は heuristic により推定し、完全性を要件にしない。

優先順位:

1. PDF Outline / metadata
2. text item の座標・フォント情報
3. heading / paragraph / list / code / table-like block 推定
4. 推定失敗時は page / ordered block へ fallback

引用再現に必要な Physical Layer は Semantic Layer の成功可否に依存させない。

## 6. Context budget

固定 Source 件数ではなく token budget を用いる。

予算配分の優先順位:

1. User question
2. User-selected SourceAnchor
3. Source の所属 block / nearby context
4. AI-expanded Source
5. Conversation Summary
6. Older history

User-selected Source が AI-expanded Source によって脱落しないことを不変条件とする。

## 7. Codex integration

`BookContextGateway` はアプリ固有の interface とし Codex protocol から独立させる。

接続の第一候補は Codex に read-only tool / MCP として公開する方式。利用中の Codex App Server で直接 tool integration が適さない場合は、Node Orchestrator による structured retrieval loop を利用する。

製品機能は接続方式に依存させない。

## 8. Markdown rendering

Markdown は AST ベースで処理する。実装では `react-markdown` + remark/rehype ecosystem を第一候補とし、SourceReference、Mermaid、Visualization fenced block を custom renderer に変換する。

任意 HTML / arbitrary JSX の実行は許可しない。

## 9. Server framework

ローカル Node.js server は Fastify を採用する。

- TypeScript と相性がよい。
- HTTP API と WebSocket を同一 server に収めやすい。
- plugin 境界で Book / Chat / Insight / Codex adapter を分離しやすい。
- ローカルアプリ用途でも過剰な framework lock-in を避けられる。

## 10. 実装開始時点の採用技術

```text
Web           React + TypeScript + Vite
Server        Node.js + TypeScript + Fastify
PDF           pdfjs-dist
UI            Tailwind CSS + shadcn/ui
Server state  TanStack Query
UI state      Zustand
Validation    Zod
DB            SQLite + Drizzle
Search        SQLite FTS5 unicode61 + trigram + substring fallback
Markdown      react-markdown + remark/rehype
Diagram       Mermaid
Flow          @xyflow/react
Chart         Recharts
Test          Vitest + Playwright
AI            codex app-server
```


## 11. 自己レビュー後の品質決定（2026-08-10）

- 日本語部分一致は `unicode61` のみでは成立しないため、CJK query は FTS5 trigram と短語 substring fallback を併用する。AI `book_search` とUI検索は同じ検索基盤を使う。
- Reader は1ページ表示を既定とし、必要時にlazy continuous scrollへ切り替える。zoomはmanual / fit-widthを持ち、fit-widthはペインresizeとページ変更に追従する。表示mode・zoom mode・reader positionはbook別に復元する。
- PDF semantic extraction は content stream order を信用せず、座標からline/column reading orderを復元する。反復margin textとページ番号はsemantic textから除外候補にする。
- 詳細な修正順序・検証ゲートは `docs/07_review_remediation_plan.md` を正本とする。
