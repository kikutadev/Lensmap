# UI・可視化仕様

Status: Accepted / Normative

> Visual design / typography / materials / spacing / motion のcanonical ruleは [Lensmap Design System](design-system.md) に従う。Apple Human Interface Guidelinesを第一参照とし、Chrome Side Panelの制約へ翻訳して適用する。

本仕様とDesign Systemは規範文書である。実装計画や既存prototypeの都合でこれらを変更しない。特に `Explore | Maps`、Map自動保存、assistantをreading surfaceとして表示すること、control layerだけにmaterialを使うこと、system typography、visual-first Mapsを固定仕様とする。

## 1. 基本構成

Lensmap は Chrome 標準 PDF Viewer の右側に開く Side Panel として動作する。

```text
┌─────────────────────────────────┬─────────────────────────┐
│ Chrome built-in PDF Viewer      │ Lensmap Side Panel      │
│                                 │                         │
│ PDF / search / outline / zoom   │ Workspace               │
│                                 │ Explore / Maps          │
│ selected text                   │ Documents / References  │
│                                 │ Answer                  │
│                                 │ Composer                │
└─────────────────────────────────┴─────────────────────────┘
```

PDF viewer機能をLensmap側で重複実装しない。

Side Panelの中心はactive Chrome tabではなくReader Workspaceである。

## 2. Header / Workspace

Header:

```text
Lensmap                     [Context gauge] [Model] [?]
```

- Context gauge: 現在ThreadのCodex Context使用率
- Model: 現在Threadのdefault model。クリックでmodel selector
- `?`: 常時Helpへ移動

Workspace selector:

```text
Workspace
[ CDN / Edgeを理解する      v ] [+]
```

Workspaceを切り替えたときだけExplore / Documents / References / Mapsの対象を切り替える。active Chrome tabの変更では切り替えない。

## 3. 選択 UX

PDF本文を選択した状態でChrome context menuに次を表示する。

```text
Lensmapで掘り下げる
Lensmapの参照に追加
```

### 掘り下げる

- user gesture中にSide Panelを先に開く
- PDF import/index、selection再同定はその後非同期で行う
- 現在WorkspaceへReferenceを追加後、質問欄へfocusする
- Workspace未選択なら初回capture時に自動作成する

### 参照に追加

- 現在WorkspaceのReference一覧へ追加する
- 質問欄へ強制focusせず読書継続を優先する

別PDFを別tabで開いた場合も同じWorkspaceへ追加できる。

### 範囲を選択

図表・数式・画像等は `範囲を選択` からVisual Sourceとして追加できる。

1. 現在のPDF tabをvisible viewport画像としてcaptureする
2. Extension所有のCapture Surfaceへ固定表示する
3. ユーザーが矩形をdragする
4. 元capture pixelへ座標変換してcropする
5. cropを一次SourceとしてWorkspaceへ追加する
6. OCR / PDF page / page rectは非同期で派生metadataとして解決する

Capture Surfaceは「直前のPDF画面がそのまま選択モードになった」ように見せる。Chrome標準PDF Viewerのprivate DOM上へ矩形UIを注入しない。full viewport captureはcommit/cancel後に保持しない。詳細は [`visual-source-capture.md`](visual-source-capture.md) を参照する。

処理中は `importing / resolving / ambiguous / capturing / ready / error` を明示する。短い内部処理段階を細かく点滅表示しない。

## 4. Documents / References

Explore画面ではWorkspace内のDocuments / Referencesをcompact summaryとして表示し、必要なときだけ展開する。

```text
Documents 2
References 3
```

展開時:

```text
Documents
- Designing Data-Intensive Applications
- Cloudflare Architecture

References
S1 · Text · Designing Data-Intensive Applications · p.80
「……」

S2 · Visual · Cloudflare Architecture · p.18
[ thumbnail ]
Client → CDN Edge → Origin
```

操作:

- WorkspaceへPDFを追加
- Referenceを外す
- 全Referenceを外す
- Referenceから元PDFページへ移動

同一Referenceの重複追加は抑止する。内部domainではSourceAnchorとして保持する。

`user-selection` と `ai-expansion` はprovenance上区別する。回答に実際に利用されたAI追加参照はcitation / retrieval summaryから確認できる。

## 5. Ambiguous selection

同一文が複数箇所にある場合は候補ページと前後文脈を表示する。

```text
引用箇所を選択

PDF p.12  …prefix [selected quote] suffix…
PDF p.86  …prefix [selected quote] suffix…
```

ユーザー選択後にだけSourceAnchorを確定する。ambiguity解決中も元のWorkspace contextを維持する。

## 6. Explore

Workspace単位で複数Explore Threadを作成・切替できる。内部domainも`ExploreThread`を正規名とする。

Composer:

- 自由入力を主操作とする
- `Cmd/Ctrl + Enter` で送信
- Sourceが0件の場合は送信不可
- streaming中の重複送信を防止

Turnには複数BookのSourceAnchorを同時添付でき、Text / Visual Sourceを混在できる。Visual Sourceを含む場合は画像入力対応modelを必須とし、OCR-onlyへ黙って劣化させない。

回答はstreaming表示し、完了後にSource citationとAI追加参照summaryを表示する。

Chrome tabを切り替えたり閉じたりしても現在Threadは維持する。

## 7. Codex control

HeaderのCodex controlを押すとpopoverを表示する。

```text
Codex

Context       31%
26k / 84k

利用枠        47%
reset 18:00

長期利用枠    12%
reset 8/18

Model
✓ GPT-5.6 Sol
  GPT-5.6 ...
```

- Contextは `thread/tokenUsage/updated` の実値を使う
- rate limitは `account/rateLimits/read` の `usedPercent` / resetを使う
- 複数windowは別々に表示する
- 推定残回数は表示しない
- model変更は現在Threadの次Turnから適用し、履歴は維持する

## 8. Citation UX / Navigation

回答中の `S#` citationはSourceAnchorと結びつく。

`S1`単体では意味が分かりにくいため、hover / focusで次を表示する。

```text
S1
Designing Data-Intensive Applications
PDF p.42

“Replication means keeping a copy of the same data...”

選択箇所
```

回答下部でもBook/page/quote previewを表示する。Visual Sourceではquoteの代わりにthumbnailを主要previewとし、OCR textがあれば補助表示する。

```text
S1 · Book A · p.42 · “Replication means keeping...”
S2 · Book B · p.18 · “Consensus requires...”  [AI追加]
```

Citationを押すと:

1. 同じPDFを開いているChrome tabがあればactivate
2. なければPDFを新規tabで開く
3. `#page=N`へ移動

標準PDF Viewerのprivate APIによるrect highlightは製品要件にしない。

## 9. AI追加参照

通常UIではraw tool logを表示しない。

例:

```text
この回答では3箇所を追加参照しました
- Book A p.43 前後文脈
- Book B p.18 検索: consensus
- Book B p.21 同一節
```

必要ならadvanced/debug viewから詳細auditを確認できる。

## 10. Maps

正常に完了したAssistant回答はすべて自動的にMapへ保存する。通常UIに手動の `Mapに保存` / `Mapにする` ボタンは置かない。保存は冪等化し、Map保存失敗によって正常なExplore回答を失敗扱いにしない。

Maps一覧はvisual-firstとする。

- visual thumbnail / preview
- title
- 2〜3行preview
- referenced Books / pages
- updated time

内部の `markdown` / block kind / `needs-review` 等を一覧へ露出しない。

Map detailの表示優先順:

1. title
2. primary visual understanding
3. concise explanation
4. Evidence
5. version / edit history

通常文章は連続したDocumentとして表示し、Table / Diagram / Chart等のvisual blockだけ独立Surfaceを持つ。

Markdown blockごとにdebugger風cardへ分断しない。

Grounding上の注意が必要なら、「要確認」ではなく意味を具体化する。

例:

- `書籍本文の直接引用を伴わないAI補足`
- `編集済み · 引用は元回答時点の根拠`

編集は既存versionを上書きせず、新versionとして保存する。

## 11. Rich Content

回答・Mapは次の3系統のみをrendererへ渡す。

1. Markdown
2. `mermaid` fenced block
3. `visualization` / `lensmap-viz` fenced block

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

## 12. Chart provenance

Chartは `sourceRefs` と `dataNature` を持つ。

```ts
type ChartDataNature = "source" | "derived" | "illustrative";
```

- `source`: 書籍記載値
- `derived`: 書籍記載値から計算
- `illustrative`: 説明用仮想値

`illustrative` を実測値のように表示しない。

## 13. Help / Onboarding

Side Panel右上の `?` から常時Helpへ到達できる。

Helpには最低限以下を含める。

1. 最初の使い方
2. Text Source / Visual Source追加
3. `範囲を選択` と画像が一次情報であること
4. 複数PDFを同じWorkspaceへ追加
5. S1/S2 citationの意味
6. AI追加参照
7. Maps自動保存
8. Codex Context / rate limit
9. model変更
10. local PDF権限
11. 現状の制約

初回だけ軽量onboardingを表示し、毎回modalを出さない。

## 14. Connection / Error UX

Server / Codexへ接続できない場合はSide Panel内で原因を表示し、再接続操作を提供する。

Native Host起動エラー、Server timeout、selection再同定失敗、Map自動保存失敗等を握りつぶさない。

ただしMap保存失敗は正常なExplore回答を失敗扱いにせず、非破壊なwarningとして扱う。ユーザー操作で復旧可能な場合は次のactionを明示する。
