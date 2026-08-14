# 製品仕様

## 1. コンセプト

Deep Reader は、Chrome で技術書 PDF を読みながら、**ユーザーがその場で選択した本文を主要根拠として AI に質問する**ローカル読書ツールである。

全文を毎回モデルへ投入するのではなく、次の 3 概念を中心にする。

```text
SourceAnchor   原文の根拠
Deep Dive      考えるための対話
Insight        残すための知識成果物
```

PDF 表示機能は Chrome 標準 PDF Viewer に委譲する。Deep Reader は Side Panel と Local Server を担当し、独自 PDF Reader は持たない。

## 2. PDF と SourceAnchor

### 2.1 読書

- HTTP / HTTPS PDF を Chrome 標準 PDF Viewer で読む
- `file://` PDF は Chrome の file access 許可が有効な場合に扱う
- 検索、ズーム、ページ移動、Outline、印刷、ダウンロードは Chrome の機能を利用する

### 2.2 選択

ユーザーが PDF 本文を選択し、コンテキストメニューから以下を実行する。

- `Deep Readerで深掘り`
- `Deep Readerの引用に追加`

Extension は選択文字列と PDF URL を取得し、Local Server が管理する PDF index 上で page / block / rect を再同定する。

SourceAnchor は少なくとも次を保持する。

- book ID
- PDF page range
- raw / normalized quote
- prefix / suffix
- text hash
- PDF rect
- related document node IDs
- origin (`user-selection` / `ai-expansion`)

同じ文字列が複数箇所に存在し一意に決められない場合は、候補ページを Side Panel に表示してユーザーに選択させる。

### 2.3 引用へ戻る

回答・Insight の Source reference を選ぶと、元の Chrome PDF tab を対象ページへ移動する。

Chrome 標準 Viewer の private DOM/API は製品ロジックから利用しない。初期版で保証するのはページ単位の navigation である。

## 3. Deep Dive

1 Turn に複数 SourceAnchor を添付できる。参照数に意味的な固定上限は設けず、aggregate context budget で制御する。

AI は user-selected Source だけで十分なら追加探索しない。不足する場合のみ、read-only book tools を通じて段階的に参照を広げる。

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

AI が実際に読んだ追加本文だけを `ai-expansion` SourceAnchor として記録する。検索候補を見ただけでは citation source にしない。

Conversation Summary は会話継続用の圧縮状態であり、citation source にはしない。

## 4. Chat / Thread

- Book ごとに複数 Deep Dive thread を作成可能
- user / assistant message と利用 Source をローカル DB に保存
- Codex thread ID は実行上の識別子として保持
- 回答 streaming を Side Panel に表示
- model capacity 等で回答生成が始まる前に限り、利用可能なモデルへの fallback を許容

通常読書モードから shell / file write を許可しない。Codex thread は approval `never`、read-only sandbox、Deep Reader専用 tool surfaceを前提にする。

## 5. PDF index / Retrieval

PDF import 時に次の 3 層を生成する。

```text
Physical
  page / text span / rect

Semantic
  section / heading / paragraph / list / code / table-like block

Retrieval
  local search unit
```

PDF の content stream order をそのまま信用せず、座標情報から reading order を復元する。Semantic inference に失敗しても Physical SourceAnchor の作成を妨げない。

検索は SQLite FTS5 を使用する。

- Latin 系: `unicode61` + BM25
- CJK: `trigram`
- trigram に適さない短語: normalized substring fallback

Embedding / vector search は初期版には含めない。

## 6. Insight

チャット回答から長期保存したい内容を `InsightArtifact` として保存する。

初期 kind:

- note
- report
- table
- diagram
- chart

Insight は immutable version history を持ち、編集時は新versionを作成する。Source provenance は version / block 単位で追跡できる。

Grounding は次を区別する。

```text
GroundingKind
  source-backed
  derived
  ai-explanation

GroundingStatus
  references-checked
  claim-verified
  modified
  needs-review
```

ユーザー編集後は元の根拠との意味的一致を自動保証しない。

## 7. Visualization

回答・Insight は通常 Markdown に加え、次を表示できる。

- Mermaid
- comparison
- flow
- hierarchy
- timeline
- matrix
- callout
- chart (`bar` / `line` / `scatter`)

任意 JSX / JavaScript / HTML は実行しない。Visualization JSON は Zod allow-list schema で検証する。

Chart は `dataNature = source | derived | illustrative` を必須とし、説明用仮想値を実測値のように表示しない。

## 8. ローカル保存と外部送信

ローカル保存:

- managed PDF copy
- PDF index
- SourceAnchor
- Chat / Thread
- Insight / versions / provenance

Codex へ送るもの:

- ユーザー質問
- user-selected source text
- 必要に応じて read-only book tools で取得した追加本文
- bounded conversation memory

詳細は [PRIVACY.md](../PRIVACY.md) を参照する。

## 9. 初期版の対象外

- OCR が必要なスキャン PDF
- EPUB
- クラウド同期
- 複数ユーザー
- 任意 Web ページの取り込み
- 外部 Web 検索を citation source として利用する機能
- 任意コード実行型Visualization
- Embedding / vector search
