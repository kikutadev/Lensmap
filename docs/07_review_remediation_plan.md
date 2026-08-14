# 自己レビュー改善計画

2026-08-10 の実装・Live E2E・コードレビューで見つかった課題を、ユーザー追加判断なしで以下の順に解消する。

## 方針

中核ループ `SourceAnchor → Deep Dive → Progressive Context Expansion → Citation → Insight` は維持し、機能を横に増やすより先に、実際の日本語技術書を日常利用できる品質へ上げる。

## P0 — 検索・Grounding の正確性

### P0-1 日本語検索

現行 `unicode61` FTS5 は日本語部分一致に弱いため、検索を hybrid 化する。

- Latin / 空白区切り語: 既存 `unicode61` + BM25
- CJK / 部分一致: FTS5 `trigram` index
- 3文字未満や trigram で拾えない短いCJK: `instr(text_normalized, ?)` fallback
- 結果は blockId で dedupe し、検索経路をUIに漏らさず同一 `BookSearchResponse` へ統合
- AIの `book_search` も同一検索基盤を利用する

### P0-2 Grounding semantics

引用IDの存在確認と意味的な主張検証を分離する。

- `references-checked`: block 内の Source ID が実在することのみ確認済み
- `claim-verified`: Source本文と主張の意味的一致まで別工程で確認済み（将来の再検証工程。自動付与しない）
- `modified`: ユーザー編集後
- `needs-review`: 不明なSource、根拠なし、その他要確認

複数Sourceがあるだけで `derived` と推定しない。通常の引用付き説明は `source-backed` とし、`derived` は明示的な推論・計算として扱う。

UI表記は `verified = 根拠確認` を廃止し、`参照確認済み` / `主張検証済み` / `編集済み` / `要確認` にする。

## P1 — Readerを読書アプリとして成立させる

- zoom in / out / fit width
- 1ページ表示を既定Reader modeとし、連続スクロールへ切替可能にする
- Page jump / citation jump は対象pageをscrollIntoView
- PDF Outline / 目次を左ペインへ表示
- Reader位置（bookごとのpage・zoom）をlocal persistenceで復元
- pane resize / collapse は次段階。まずReader中央領域の実用性を優先
- Markdown ordered list の `start` を保持し、Insightの番号崩れを修正

## P2 — 実PDF耐性

- PDF indexerのreading orderを座標ベースで再構成
- ヘッダー/フッター候補を反復出現から除外できる下地を追加
- 2段組を単純なTextItem順に依存しない
- 日本語、2段組、コード、表、ページ跨ぎをfixture testへ追加
- SourceAnchor physical rect は semantic extractionの成否から独立させる

## P3 — InsightをKnowledge Baseへ完成させる

- Insight titleを長い質問文そのままにしない。保存時に短い既定titleを導出
- Insight edit API / UI
- 編集ごとに ArtifactVersion を新規作成
- 編集されたblockは `modified`、根拠なし変更は `needs-review`
- version history表示
- version diff（最低限 block単位）
- Insightを起点に新Deep DiveへSourceを再添付
- Tag/filter はversioning完了後

## P4 — 長期利用・保守性

- 1 Book複数Chatの作成・切替
- Conversation summary / history budget（summaryは根拠にしない）
- `ChatService`、`CodexAppServerClient`、`DeepDivePanel`、`VisualizationBlock` の責務分割
- Mermaid/Visualization/PDF workerをさらに遅延loadして初期bundleを縮小
- production dependency audit 0件を維持し、dev-only advisoryは更新可能性を定期確認

## 検証ゲート

各段階で以下を満たしてからcommitする。

```bash
npm run check
git diff --check
```

中核フローに触れた段階では追加で実Codexを使う。

```bash
npm run e2e:live
```

Live E2Eでは、PDF import → 複数Source → 実Codex App Server → AI追加探索 → citation jump → Insight保存を継続して保証する。


## 実装状況（2026-08-10）

- P0: 実装済み。日本語hybrid searchとGrounding semantics分離をテスト済み。
- P1: 実装済み。single-page / continuous切替、manual zoom / fit-width自動追従、PDF/semantic outline、position restore、pane resize/collapse、ordered-list start保持を追加。
- P2: 基盤実装済み。座標reading order、2段組、反復margin除外、embedded Outline永続化を追加。NIST SP 800-207 59-page PDFで実抽出評価を実施。
- P3: 実装済み。Insight短縮title、編集→immutable version、history/diff、Tag/filter、Insight→Deep Diveを追加。
- P4: 主要項目実装済み。1 Book複数Chat、bounded non-citeable Conversation Memory、model context window連動Expansion Budget、feature-level lazy load、遠方PDFページのCanvas/TextLayer unrenderを追加し、120ページPlaywright E2Eで保持数をboundedに検証。長尺PDFで判明したReader/Deep Dive高さ制約も修正。大きいMermaid系lazy chunkの最適化は継続候補。
