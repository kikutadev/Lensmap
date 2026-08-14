# UI・可視化仕様

## 1. 基本構成

Deep Reader は Chrome 標準 PDF Viewer の右側に開く Side Panel として動作する。

```text
┌─────────────────────────────────┬─────────────────────────┐
│ Chrome built-in PDF Viewer      │ Deep Reader Side Panel  │
│                                 │                         │
│ PDF / search / outline / zoom   │ Chat / Insights         │
│                                 │ Sources                 │
│ selected text                   │ Answer                  │
│                                 │ Rich visualization      │
│                                 │ Composer                │
└─────────────────────────────────┴─────────────────────────┘
```

PDF viewer機能をDeep Reader側で重複実装しない。

## 2. 選択 UX

PDF本文を選択した状態でChrome context menuに次を表示する。

```text
Deep Readerで深掘り
Deep Readerの引用に追加
```

### 深掘り

- user gesture中にSide Panelを先に開く
- PDF import/index、selection再同定はその後非同期で行う
- Source追加後、質問欄へfocusする

### 引用に追加

- 現在のSource一覧へ追加する
- 質問欄へ強制focusせず読書継続を優先する

処理中は `importing / resolving / ambiguous / ready / error` を明示する。短い内部処理段階を細かく点滅表示しない。

## 3. Sources

Side Panelに現在添付中のSourceを表示する。

```text
Sources  2

S1 · PDF p.80
「……」

S2 · PDF p.83
「……」
```

操作:

- Sourceを外す
- 全Sourceを外す
- Sourceから元PDFページへ移動

同一Sourceの重複追加は抑止する。

`user-selection` と `ai-expansion` はprovenance上区別する。回答に実際に利用されたAI追加参照は、citation / retrieval auditから確認できる。

## 4. Ambiguous selection

同一文が複数箇所にある場合は候補ページと前後文脈を表示する。

```text
引用箇所を選択

PDF p.12  …prefix [selected quote] suffix…
PDF p.86  …prefix [selected quote] suffix…
```

ユーザー選択後にだけSourceAnchorを確定する。

## 5. Chat

Book単位で複数Deep Dive threadを作成・切替できる。

Composer:

- 自由入力を主操作とする
- `Cmd/Ctrl + Enter` で送信
- Sourceが0件の場合は送信不可
- streaming中の重複送信を防止

回答はstreaming表示し、完了後にSource citationとretrieval auditを表示する。

## 6. Citation navigation

回答中の `S#` citationはSourceAnchorと結びつく。

UIでは可能な場合に印刷ページラベルを優先し、なければPDF pageを表示する。

Citationを押すと対象Chrome tabを `#page=N` へ移動し、標準PDF Viewerを対象ページへ遷移させる。private viewer APIによるrect highlightは製品要件にしない。

## 7. Insights

回答をInsightとして保存できる。

Insight一覧:

- title
- kind
- version
- source count

Insight detail:

- content
- Source一覧
- version history
- 編集
- diff

編集は既存versionを上書きせず、新versionとして保存する。

## 8. Rich Content

回答・Insightは次の3系統のみをrendererへ渡す。

1. Markdown
2. `mermaid` fenced block
3. `visualization` / `deep-reader-viz` fenced block

### Markdown

- headings
- list
- table
- inline code
- code block
- GFM
- sanitize

### Mermaid

Mermaidは `securityLevel: strict` でlazy renderする。Syntax errorは当該blockだけに表示する。

### Visualization DSL

allow-list:

```text
comparison
flow
hierarchy
timeline
matrix
callout
chart
```

Chart:

```text
bar
line
scatter
```

すべてのvisualizationはZod schemaを通す。任意JSX / JavaScript / HTMLは実行しない。

## 9. Chart provenance

Chartは `sourceRefs` と `dataNature` を持つ。

```ts
type ChartDataNature = "source" | "derived" | "illustrative";
```

- `source`: 書籍記載値
- `derived`: 書籍記載値から計算
- `illustrative`: 説明用仮想値

`illustrative` を実測値のように表示しない。

## 10. Connection / Error UX

Server / Codexへ接続できない場合はSide Panel内で原因を表示し、再接続操作を提供する。

Native Host起動エラー、Server timeout、selection再同定失敗等を握りつぶさない。ユーザー操作で復旧可能な場合は次のactionを明示する。
