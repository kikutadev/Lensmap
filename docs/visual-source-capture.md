# Visual Focus / Source Capture 仕様

Status: Accepted
Date: 2026-08-14

## 1. 目的

Lensmap はテキスト選択だけでなく、PDF 上の図、表、数式、コード画像、スクリーンショット、複雑なレイアウト等を **Visual Source** として根拠化できるようにする。

Visual Source では、ユーザーが選択した **画像そのものを一次情報** とする。

Concept上はText PassageとVisual Regionの双方をFocusとして扱う。Visual Sourceは「passageの例外」ではなく、人間の注意を起点にする正式な入口である。

OCR text、PDF page、PDF rect、説明文、AIによる理解結果は、画像から導出された二次情報であり、一次情報を置き換えない。

```text
Visual Source
  primary      cropped image
  derived      OCR text / page / PDF rect / semantic links / description
```

Chrome 標準 PDF Viewer は引き続き表示 Surface として利用し、private DOM / private PDF Viewer API へ依存しない。

---

## 2. SourceAnchor 型

`SourceAnchor` は text-only object ではなく、少なくとも次の discriminated union とする。

```ts
type SourceAnchor = TextSourceAnchor | VisualSourceAnchor;

interface TextSourceAnchor {
  kind: "text";
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

interface VisualSourceAnchor {
  kind: "visual";
  id: string;
  bookId: string;

  // Primary source. Never reconstructed from OCR.
  imageAssetId: string;

  // Capture-time geometry relative to the captured tab image.
  captureImageWidthPx: number;
  captureImageHeightPx: number;
  captureRectNormalized: NormalizedRect;

  // Derived PDF location. Optional because visual evidence remains valid
  // even if PDF re-identification is incomplete.
  locationStatus: "unresolved" | "page-resolved" | "rect-resolved";
  page?: number;
  pageRectNormalized?: NormalizedRect;
  locationConfidence?: number;

  // Derived searchable representation.
  recognizedText?: string;
  ocrConfidence?: number;
  documentNodeIds: string[];

  origin: "user-selection" | "ai-expansion";
}
```

`NormalizedRect` は `0..1` の page/capture-relative coordinate とし、zoom、window size、device pixel ratioから独立して永続化できる形にする。

`captureRectNormalized` は必ず保存する。`page` / `pageRectNormalized` は再同定できた場合のみ保存し、推測値を確定値として記録しない。

---

## 3. Capture UX

### 3.1 起動

PDFを表示している状態からFocusとして次の操作でVisual Captureを開始できるようにする。

- Side Panel の `範囲を選択`
- 将来のkeyboard shortcut

Capture開始時点で対象tabがLensmapで認識済みのPDF/Bookであることを確認する。

### 3.2 Capture Surface

Chrome標準PDF Viewerへ矩形overlayを注入しない。

代わりに、現在見えているPDF tabを `chrome.tabs.captureVisibleTab()` で一度画像化し、**Extension所有のCapture Surface** にその画像を表示する。

```text
Chrome PDF Viewer
     ↓ captureVisibleTab()
Captured viewport image
     ↓
Extension-owned Capture Surface
     ↓ drag rectangle
Selected visual region
```

Capture Surfaceは取得済み画像を固定表示するため、選択中に元PDFがscroll/zoomしても選択座標は変化しない。

ユーザーには「直前まで見ていた画面がそのまま選択画面になった」と感じられる遷移を目標とする。

Capture Surfaceの具体的なcontainer（temporary extension tab等）は実装詳細とする。ただしChrome PDF Viewerのprivate DOMへのoverlayを前提にしない。

### 3.3 座標変換

矩形選択UIのdisplay座標ではなく、元capture画像のpixel座標へ変換してcropする。

```text
Display rect
   ↓ scale by capturedImageSize / renderedImageSize
Capture pixel rect
   ↓ normalize
captureRectNormalized
```

device pixel ratioやCapture Surface上のfit/scaleに依存せず、元capture画像から正確にcropできることを必須とする。

### 3.4 保存

確定時に保存する一次資産は選択矩形のcrop画像である。

- master assetはlossless PNGを基本とする
- 元のfull viewport captureは一時データとし、crop確定またはcancel後に削除する
- model送信用にresize等が必要な場合はmasterから派生assetを生成し、masterを置き換えない

---

## 4. PDF位置への再同定

Visual Sourceはcapture画像内の位置を確実に保持できる一方、それだけではPDF page coordinateではない。

LensmapはLocal Serverにmanaged PDFとPDF indexを持つため、以下の段階でPDF位置へ再同定する。

```text
Cropped image
   ├─ OCR
   │    ↓
   │  PDF text indexでcandidate page/blockを絞る
   │
   └──────────────┐
                  ↓
        candidate PDF pagesをrender
                  ↓
       image / layout alignment
                  ↓
     page + page-relative rect
```

### 4.1 再同定レベル

再同定結果は成功/失敗のbooleanにしない。

```text
unresolved
  画像Sourceとしては利用可能。PDF page未確定。

page-resolved
  PDF pageまで確定。page内rectは未確定。

rect-resolved
  PDF page + normalized rectまで確定。
```

`locationConfidence` を保持し、閾値未満のcandidateを確定位置として保存しない。

### 4.2 OCRの役割

OCRはVisual Sourceの代替ではない。次のための補助情報とする。

- PDF index上のcandidate page絞り込み
- Workspace Search
- Reference preview
- AI retrievalのlexical hint
- accessibility

図の矢印、位置関係、色、形状、表レイアウト、数式構造などOCRで失われる情報は画像を正とする。

### 4.3 OCRがほぼ取れない図

OCR文字列が短い、または存在しない図でもVisual Source作成を許可する。

画像matching等で位置を確定できなければ `unresolved` のまま保持する。位置再同定失敗を理由にSource作成自体を失敗させない。

---

## 5. Codexへの入力

Visual Sourceを含むTurnでは、Codexへ **画像と派生テキストを併用**して渡す。

installed Codex App Serverがサポートする user input modalityを `model/list` で確認し、画像対応modelには `localImage` を利用する。

概念的な入力:

```text
Text input
  User question

Text input
  S2 metadata
  Book / page if resolved / OCR text / provenance

Local image input
  S2 cropped image
```

画像をbase64文字列としてprompt本文へ埋め込まない。

### 5.1 Model capability

Visual Sourceを含むTurnは `image` input modality対応modelを必要とする。

現在のThread modelが画像入力非対応の場合、OCR-onlyへ黙って劣化させない。

UIで画像対応modelへの変更を要求する。将来自動fallbackを導入する場合も、「画像そのものが送られなかった」状態をユーザーに隠さない。

### 5.2 Image detail / resize

Codex protocolのimage detailはmodel capabilityと実測に基づき設定する。初期値はmodel側の自動選択を優先する。

入力制約に合わせたresizeが必要な場合、送信用derivativeを生成するが、ローカルのmaster cropは保持する。

---

## 6. Workspace / Retrievalとの統合

Visual SourceはText Sourceと同様に現在のReader Workspaceへ属するSourceとして扱う。

1 TurnにText / Visualを混在でき、複数Bookを跨げる。

```text
Workspace
  S1 Text   Book A p.83
  S2 Visual Book A p.84
  S3 Visual Book B p.18
```

OCR textはWorkspace lexical searchへ利用可能にする。ただし検索hitがVisual Sourceを指した場合、AIへ読ませる一次情報は可能な限りcrop画像とする。

AIが自動探索でVisual Sourceを利用した場合も、実際に画像をmodel inputへ渡した時点で `ai-expansion` provenanceへ昇格させる。

検索候補を見ただけではEvidence sourceにしない。

---

## 7. Evidence / Citation UX

Visual Source citationはquoteだけでなくthumbnailを主要previewとする。

```text
S2 · Visual · Book A · p.84
[ thumbnail ]
LSM-tree compaction diagram
```

`recognizedText` がある場合は補助previewとして表示してよいが、画像previewを置き換えない。

Citation click時:

1. 同じPDFを表示中のChrome tabがあればactivate
2. なければPDFを開く
3. `page`がresolvedなら `#page=N` へ移動
4. `pageRectNormalized` があってもChrome標準PDF Viewer上への恒久overlayは保証しない

精密位置を確認する機能が必要な場合は、Lensmap所有のCapture/Preview Surface上で保存済み画像または再renderしたpageへrectを重ねる。

---

## 8. Privacy / lifecycle

Captureはユーザー明示操作でのみ開始する。

- active PDF tabのみcapture対象とする
- full viewport captureは一時データ
- cancel時は保存しない
- commit後はcrop画像だけをmanaged assetとして保持する
- Visual SourceをTurnへ添付した場合、そのcrop画像はCodexへの入力対象になる
- full viewport captureをCodexへ送らない
- debug logへ画像binary/data URLを出さない

Help / Privacy文書には「選択した画像領域がCodexへ送信される」ことを明記する。

---

## 9. Error / fallback

### capture失敗

Visual Sourceを作成せず、再試行可能なerrorを表示する。

### OCR失敗

画像Sourceは作成する。OCR failureは非致命的warningとする。

### PDF位置再同定失敗

`locationStatus = unresolved` でSourceを保持する。画像入力は利用可能。

### image非対応model

画像を捨てて送信しない。model変更を要求する。

### Codex image input失敗

Turn全体の画像入力失敗として明示し、OCR-only回答へ自動的に切り替えない。

---

## 10. MVP完了条件

1. Chrome標準PDF Viewerを表示中に `範囲を選択` を開始できる。
2. 直前のvisible viewportを固定したCapture Surface上で矩形選択できる。
3. 表示scaleに関係なく元capture pixelから正しいcropを生成できる。
4. crop PNGを一次Sourceとして保存できる。
5. full viewport captureはcommit/cancel後に残らない。
6. OCR成功/失敗に関係なくVisual Sourceを作成できる。
7. PDF page/rect再同定結果を `unresolved / page-resolved / rect-resolved` で保持できる。
8. Visual SourceをText Sourceと同じWorkspace/Turnで利用できる。
9. 複数PDFのVisual Sourceを同じTurnへ添付できる。
10. image-capable Codex modelへcrop画像を `localImage` として渡せる。
11. OCR textも補助context/search metadataとして利用できる。
12. Visual citationにthumbnail、Book、resolved pageを表示できる。
13. citationからresolved pageへ戻れる。
14. Chrome PDF Viewerのprivate DOM/APIや恒久overlayに依存しない。
15. Headless/fixture testで座標変換、crop、保存、OCR failure、location fallback、model capability判定を再現できる。

---

## 11. 対象外

初期実装では以下を保証しない。

- Chrome標準PDF Viewer上への保存済みrectの恒久highlight
- Visual Sourceからの完全な図構造抽出
- OCRによる画像内容の完全再現
- unresolved Visual SourceのPDF rect捏造
- ユーザー操作なしのviewport自動capture
- PDF全ページを無条件に画像化してCodexへ送信する処理
