# 製品仕様

Status: Accepted / Normative

## 1. コンセプト

Lensmap は、Chrome で技術書 PDF を読みながら、**気になった一節や図表を起点に必要な文脈を掘り、根拠付きの理解を Map として残す**ローカル読書ツールである。

上位原則は [`concept.md`](concept.md) を正とする。

関連する設計判断: [`ADR-001: Structured Map Composition`](adr/ADR-001_structured-map-composition.md)

UI・visual designは [`design-system.md`](design-system.md) と [`ui-and-visualization.md`](ui-and-visualization.md) を規範仕様とする。Apple Human Interface Guidelinesを第一参照とし、Chrome Side Panelの制約へ翻訳して適用する。

```text
Workspace       読書テーマ
Focus / Source  人間が注目した根拠
Explore         理解を掘る Lens
MapArtifact     自動的に残る理解の地図
```

PDF表示はChrome標準PDF Viewerへ委譲する。LensmapはSide PanelとLocal Serverを担当し、独自PDF Readerを持たない。

Chrome TabはWorkspaceの所有者ではなく、PDF表示・Focus capture・Evidenceから原文へ戻るための **Document View / Capture Surface** とする。

## 2. Reader Workspace

1 Workspaceに複数PDF / Bookを追加できる。

```text
Reader Workspace
 ├─ Documents
 │   ├─ Book A
 │   └─ Book B
 ├─ References
 ├─ Explore Threads
 └─ Maps
```

- Explore Threadは`workspaceId`に属する
- active tab切替だけではWorkspace / Threadを切り替えない
- PDF tabを閉じてもWorkspace / Explore / References / Mapsは残る
- 同じPDFを複数tabで開いても同じBookとして扱う
- Focusは現在選択中のWorkspaceへ追加する
- Workspace未選択時は最初のFocus captureで自動作成する
- WorkspaceとBookはmany-to-manyとする

## 3. Focus / SourceAnchor

`SourceAnchor` は内部domain名であり、UIでは `参照` / `選択箇所` / `図表` を優先する。

```ts
type SourceAnchor = TextSourceAnchor | VisualSourceAnchor;
```

### 3.1 Text Focus

PDF本文を選択し、context menuから次を実行できる。

- `Lensmapで掘り下げる`
- `Lensmapの参照に追加`

Extensionは選択文字列とPDF URLを取得し、Local ServerのPDF index上でpage / block / rectを再同定する。

Text Sourceは少なくとも次を保持する。

- book ID
- PDF page range
- raw / normalized quote
- prefix / suffix
- text hash
- PDF rect
- related document node IDs
- origin (`user-selection` / `ai-expansion`)

同じ文字列が複数箇所にあり一意に決められない場合は、候補ページと前後文脈を提示してユーザーに選択させる。

### 3.2 Visual Focus

図、表、数式、コード画像、スクリーンショット、複雑なレイアウト等はVisual Sourceとして扱う。

- `captureVisibleTab()`で現在のvisible viewportを一時captureする
- Extension所有のCapture Surface上で矩形選択する
- 確定時は矩形cropだけをlossless master assetとして保存する
- crop画像そのものを一次情報とする
- OCR / page / PDF rect / descriptionは派生metadataとする
- PDF位置再同定に失敗してもVisual Source自体は有効とする

位置解決状態:

```text
unresolved
page-resolved
rect-resolved
```

詳細は [`visual-source-capture.md`](visual-source-capture.md) を参照する。

### 3.3 Evidenceから原文へ戻る

Evidence / citationはBook title / page / quoteまたはthumbnail previewを持つ。

選択時:

1. 同じPDFを開いているChrome tabがあればactivate
2. なければPDFを新しいtabで開く
3. pageがresolvedなら`#page=N`へ移動

Chrome標準PDF Viewerのprivate DOM/APIへ依存しないため、rect単位の恒久highlightは保証しない。Visual Sourceが`unresolved`の場合はPDF位置を推測してnavigateしない。

## 4. Explore / Context Expansion

1 Turnに複数SourceAnchorを添付でき、複数BookのText / Visual Sourceを混在できる。参照数に意味的な固定上限は設けず、Context Budgetで制御する。

LensmapのAIは「本を代わりに読む主体」ではなく、Focusへ当てるLensである。明示Sourceを最優先し、質問への理解を改善する意味がある場合だけ文脈を広げる。

```text
Explicit Sources
  ↓
Nearby Blocks
  ↓
Same Section
  ↓
Workspace Search
  ↓
Necessary passages only
```

比較、因果、定義、設計意図、章全体との関係、複数概念の統合では、追加探索が有用なら明示Sourceだけで表面的に回答可能でも文脈を広げてよい。

検索候補を見ただけではEvidenceにしない。実際にAIが読んだ本文、または画像入力へ渡したVisual Sourceだけを`ai-expansion` SourceAnchorとして記録する。

何を検索し、どのBookのどの本文を実際に読んだかはaudit可能にする。

Conversation Summaryは会話継続用の圧縮状態であり、Evidenceにはしない。

## 5. Explore Thread

- Workspaceごとに複数Explore Threadを作成可能
- user / assistant messageと利用SourceをローカルDBへ保存
- Codex thread IDは実行上の識別子として保持
- 回答streamingをSide Panelへ表示
- model capacity等で回答生成開始前に限り利用可能modelへのfallbackを許容

Codex modelはThread単位のdefaultとする。変更は次Turnから適用し、Explore履歴は維持する。

通常読書モードからshell / file writeを許可しない。Codex threadはapproval `never`、read-only sandbox、Lensmap専用tool surfaceを前提とする。

## 6. Codex Control

Side Panel headerから現在のmodel、Context使用率、rate limitを確認できる。

- model list: installed Codexの`model/list`
- Context: `thread/tokenUsage/updated` の `totalTokens / modelContextWindow`
- rate limit: `account/rateLimits/read` の `usedPercent` / reset

推定の「あと何回使えるか」は表示しない。技術情報は主役にせずpopoverへ収める。

Visual Sourceを含むTurnでは`image` input modality対応modelを必須とし、OCR-onlyへ黙って劣化させない。画像対応modelではCodex App Serverの`localImage`入力を利用する。

## 7. PDF Index / Retrieval

PDF import時に次の3層を生成する。

```text
Physical
  page / text span / rect

Semantic
  section / heading / paragraph / list / code / table-like block

Retrieval
  local search unit
```

PDF content stream orderをそのまま信用せず、座標情報からreading orderを復元する。Semantic inference失敗時もPhysical SourceAnchor作成を妨げない。

検索:

- Latin: SQLite FTS5 `unicode61` + BM25
- CJK: SQLite FTS5 `trigram`
- 短語: normalized substring fallback

Embedding / vector searchは初期版に含めない。

## 8. MapArtifact

正常に完了したAssistant responseは、ユーザー操作なしで`MapArtifact`として自動保存する。

MapArtifactは回答ログのコピーではなく、**理解の構造が見え、単体で再利用できる保存成果物**とする。

最低条件:

- One idea
- Structured
- Visual where useful
- Grounded
- Traceable
- Reusable
- Versioned

MapArtifact自体を`note / report / table / diagram / chart`のkindで分類しない。これらは表示形式である。一方、Mapが何を理解した成果物かは `definition / comparison / causal / process / hierarchy / timeline / quantitative / synthesis` の意味分類として保持する。1つのMapはNarrative / Definition / Table / Diagram / Chart等のMapBlockを組み合わせる。

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
  semanticKind: "definition" | "comparison" | "causal" | "process" | "hierarchy" | "timeline" | "quantitative" | "synthesis";
  primaryBlockId: string | null;
  // concise explanation / blocks / provenance ...
}
```

通常APIのMap detail / summaryにはlatest versionの `semanticKind` / `primaryBlockId` を投影してよい。

- `originTurnId`で冪等化する
- Map保存失敗は正常なExplore回答を失敗扱いにしない
- Explore Threadを削除してもMapは保持する
- Source provenanceをversion / block単位で追跡する
- 編集は新しいMapVersionを作る
- MapのBook集合はSource provenanceから導出する

詳細は [`maps-and-context-retrieval.md`](maps-and-context-retrieval.md) を参照する。

## 9. Map Presentation / Visualization

Explore回答とMapは、内容に応じて次を組み合わせる。構造化できる理解は生成時点で構造化し、表示が文章中心でも内部まで非構造化テキストに戻さない。

- concise narrative
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

`definition` Mapが文章中心、`comparison` Mapが単純tableだけでも正式なMapとして成立する。図解に意味がある場合だけvisual structureを利用し、diagramを強制しない。

CodexにはLensmap専用Map Composition Skillを渡し、意味分類・最小表現・Source対応・JSON DSLの使い分けをSkill側で規定する。成功Turnではclient-provided `lensmap_compose_map` dynamic toolへstructured Map Draftを提出し、Local ServerがZod検証して自動保存する。Draftがない場合のみMarkdown parsingへfallbackする。

任意JSX / JavaScript / HTMLは実行しない。Structured Map JSONはZod allow-list schemaで検証する。

Chartは`dataNature = source | derived | illustrative`を必須とし、説明用仮想値を実測値のように表示しない。

## 10. Maps UI

Primary navigation:

```text
Explore | Maps
```

Maps listはvisual-firstとする。

- visual thumbnail / preview
- title
- 2〜3行preview
- referenced Books / pages
- updated time

Map detailの優先順:

1. title
2. primary visual understanding
3. concise explanation
4. Evidence
5. version / edit history

内部block kind、renderer名、`needs-review`等を通常UIの主情報にしない。

## 11. Help / Onboarding

Side Panel右上の`?`から常時Helpへ到達できる。

Help / onboardingはCore Loop順に説明する。

```text
1. Focus — 一節・図表を選ぶ
2. Explore — 問いを掘る
3. Expand — 必要ならAIが文脈を広げる
4. Map — 理解が自動的に残る
5. Return — EvidenceからPDFへ戻る
```

加えて次を扱う。

- 複数PDF Workspace
- Text / Visual Source
- AI追加参照
- Codex Context / rate limit / model selector
- local PDF権限
- 現状の制約

### 11.1 表示言語

Chrome Extension本体は初回リリースから日本語 / 英語を正式対応する。翻訳SSOTはWXT i18n catalogとし、Side PanelだけでなくManifest、context menu、Help、Visual Capture、aria/title、Lensmap所有のエラー文言まで同じcatalogから解決する。

表示言語は次の3状態を持つ。

```text
System   Chrome / browser UI languageへ追従
English  英語へ明示固定
日本語   日本語へ明示固定
```

- default localeはEnglishとする
- `System`では`browser.i18n` / WXT i18nのlocale resolutionを正とする
- 明示overrideは`chrome.storage.local`へ保存し、Extensionの再buildなしで既存画面へ反映する
- locale変更でReader Workspace、Explore、Map、Capture等の製品状態をresetしない
- AI生成本文の言語はUI localeとは別概念とし、UI翻訳で生成済み回答そのものを書き換えない
- 日本語LPには日本語Extension実画面、英語LPには英語Extension実画面を使用する
- i18n受入は機能full E2Eから分離したEN/JA smoke E2Eで保証し、既に開いているSide Panel / Helpのruntime切替と設定永続化を検証する

## 12. ローカル保存と外部送信

ローカル保存:

- managed PDF copy
- PDF index
- Reader Workspace / Workspace-Book relation
- SourceAnchor / Visual Source assets
- Explore Threads / Turns
- MapArtifact / MapVersion / provenance

Codexへ送るもの:

- ユーザー質問
- user-selected Text Source text
- Turnへ添付されたVisual Source crop画像
- Visual SourceのOCR / derived metadata（存在する場合）
- 必要に応じてread-only Workspace toolsで取得した追加本文
- bounded conversation memory

詳細は [PRIVACY.md](../PRIVACY.md) を参照する。

## 13. 初期版の対象外

- スキャンPDF全体をOCRして通常Text indexとして扱う機能（Visual Sourceの選択範囲OCRは対象内）
- EPUB
- クラウド同期
- 複数ユーザー
- 任意Webページ取り込み
- 外部Web検索をEvidenceとして利用する機能
- 任意コード実行型Visualization
- Embedding / vector search
- 自由Canvas型Map editor
