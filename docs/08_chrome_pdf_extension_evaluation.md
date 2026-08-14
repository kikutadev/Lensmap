# Chrome標準PDF Viewer + WXT Side Panel 評価

## 1. 結論

Deep Reader の主価値は PDF Viewer 自体ではなく、次の知識化ループにある。

```text
読む
→ 根拠箇所を選ぶ
→ Deep Dive
→ 必要ならAIが書籍内を追加参照
→ citationから原文へ戻る
→ Insightとして残す
```

Chrome利用時は、PDF表示・検索・zoom・ページ表示・印刷・ダウンロード・標準キーボード操作をChrome標準PDF Viewerへ委譲し、Deep Readerを **WXT + TypeScript + React のChrome Extension Side Panel** として提供する構成を推奨する。

独自PDF.js Readerは standalone / non-Chrome fallback として当面保持する。

---

## 2. 実装スタック

```text
WXT 0.21.x
TypeScript
React 19
TanStack Query
Zustand
Manifest V3
chrome.sidePanel / contextMenus / storage / tabs / activeTab / nativeMessaging
```

Extension workspace:

```text
apps/chrome-extension/
├─ entrypoints/
│  ├─ background.ts
│  ├─ probe/
│  └─ sidepanel/
├─ lib/
│  ├─ api.ts
│  ├─ context-menu-flow.ts
│  ├─ request-server-startup.ts
│  ├─ server-startup.ts
│  ├─ state.ts
│  └─ tab-state-machine.ts
├─ package.json
├─ tsconfig.json
└─ wxt.config.ts
```

WXTのproduction outputは `apps/chrome-extension/.output/chrome-mv3/` に生成し、Git管理しない。

---

## 3. 製品アーキテクチャ

```text
Chrome built-in PDF Viewer
        │
        │ selected text
        ▼
Context Menu
  ├─ Deep Readerで深掘り
  └─ Deep Readerの引用に追加
        │
        ├─ user gesture中にSide Panelを即時open
        ▼
WXT Background Service Worker
        │
        ├─ Deep Reader Server health check
        ├─ 停止中のみNative Messaging Hostへensure-server
        ├─ current PDFを取得
        ├─ Deep Reader Serverへimport/index
        └─ selection textをpage/block/rectへ再同定
                 │
                 ▼
           SourceAnchor
                 │
                 ▼
WXT React Side Panel
  Sources / Chat / citations / Insights
                 │
                 ▼
        Local Deep Reader Server
                 │
                 ▼
           codex app-server
```

製品実装はChrome内部PDF ViewerのDOM/private APIへ依存しない。

Chrome内部APIの参照は、E2Eで「標準Viewerが本当にページNを表示しているか」等を観測する場合だけに限定する。

### 3.1 Local Serverのオンデマンド起動

Deep Reader ServerはMacログイン時・Chrome起動時には起動しない。Deep Readerを実際に使ったときだけ起動する。

```text
Side Panel open または PDF capture
  ↓
Background: GET /api/health
  ├─ healthy → そのまま継続
  └─ offline
       ↓
     chrome.runtime.sendNativeMessage("com.deepreader.launcher")
       ↓
     Native Host
       ↓
     scripts/deep-reader-server.mjs start
       ↓
     /api/health ready
       ↓
     capture / Codex statusを継続
```

設計上の制約は次とする。

- Native HostはServer process managerを再実装せず、既存production controllerを呼ぶだけにする。
- `launchd` / KeepAlive / Login Itemは導入しない。
- 同時に複数のSide Panel/captureから要求されてもExtension側で共有startup Promiseにまとめる。
- ServerがすでにhealthyならNative Messagingを呼ばない。
- Native Host未登録・起動失敗・health timeoutは、Side Panelへ原因を表示する。
- ChromeのNative Messaging `allowed_origins` が固定できるようExtension IDをmanifest public keyで固定する。
- macOS初回登録は `npm run native-host:install`、診断は `npm run native-host:status` とする。Chrome 146以降は通常ChromeとChrome for TestingでNative Messaging Hostのユーザー登録先が分離されるため、installerは両方へ同一manifestを登録する。E2Eの隔離`userDataDir`には同manifestをプロファイル配下の`NativeMessagingHosts`へ複製する。

Native Host自体はChromeが要求時に生成する短命プロセスであり、常駐サービスではない。

---

## 4. Selection再同定

Chromeのcontext menuから取得する一次情報は、原則として選択文字列と現在PDF URLだけとする。

```text
selectionText
  ↓ normalize
managed PDF index
  ↓
page / DocumentBlock / PDF rects
  ↓
SourceAnchor
```

API:

```text
POST /api/books/:bookId/sources/resolve
```

同一文が複数箇所に存在する場合は自動確定しない。Side Panelに候補ページと前後文脈を表示し、ユーザーが読んでいた箇所を選択する。

---

## 5. タブ / Document単位状態

Extension stateは単純なtab IDだけではなく、現在tabで開いているPDF document identityとセットで扱う。

```text
Tab A / PDF A
  pdfUrl
  bookId
  Sources
  threadId
  selection candidates

同じTab Aで PDF Bへ遷移
  → PDF AのSources / thread / assistant / ambiguityをreset
  → PDF Bのdocument contextを新規開始
```

`tabs.onUpdated` でURL遷移を監視する。PDFから別ページへ移動した場合や同一tabで別PDFへ移動した場合、古い非同期captureをabortし、document contextをresetする。

`chrome.storage.local`のtab stateはtabごとの独立keyで保存し、複数tabが同時に更新されても全tab状態のread-modify-write競合が起きないようにする。旧 `deepReaderTabStates` 形式は読み込み時にmigrationする。

タブclose時はtab stateとlast assistantを削除する。

---

## 6. Capture lifecycle

Context Menuクリック時は、Chromeのuser gesture制約を守るためSide Panelを先にopenする。

```text
contextMenus.onClicked
  ├─ sidePanel.open()      // user gesture中に即時
  └─ beginCapture()
       ├─ importing
       ├─ resolving
       └─ ready / ambiguous / error
```

Side Panel表示失敗とPDF capture失敗は別の障害として扱う。Panel表示だけ失敗しても、成功したSourceAnchorをerror stateで上書きしない。

Captureには次を持つ。

- captureId
- AbortController
- timeout
- superseded capture破棄
- navigation時abort
- user cancel

古いcaptureが新しいPDF/tab stateを後から上書きしないよう、state更新時にcaptureIdを照合する。

---

## 7. Side Panel状態

Codex streaming / draft / selected Insight等の一時UI stateはtabごとに保持する。

PDF Aで回答生成中にPDF Bへ切り替えても、Aのstreaming内容・送信禁止状態・draftがBへ漏れない。

エラーはstreaming messageではなく独立したerror stateとして表示する。citation / ambiguity candidate等のruntime messageも `{ ok, error }` を検査し、失敗をSide Panelに表示する。

---

## 8. Citation navigation

Chrome標準PDF Viewerは、初回ロード時には `#page=N` を解釈するが、既に開いたPDFのhashだけを書き換えてもviewportが変わらない場合がある。

そのためcitation navigationは次の手順とする。

```text
chrome.tabs.update(tabId, { url: pdfUrl + "#page=N" })
→ tabs.getでURL反映を確認
→ chrome.tabs.reload(tabId)
```

E2EではURLだけではなくChrome Viewer内部のpage selectorが対象ページへ確定するまで待って検証する。

---

## 9. HTTP / Local PDF

### 通常HTTP PDF

Service Workerが現在PDFを再取得し、managed storageへimport/indexする。

### Cookie認証付きHTTP PDF

ブラウザで認証済みCookieを持つPDFについて、Extension側の `fetch(..., { credentials: "include" })` で同じPDFを再取得する。

### file:// PDF

Manifestで `file:///*` を宣言する。製品利用時は `chrome.extension.isAllowedFileSchemeAccess()` を確認し、未許可ならChrome拡張詳細画面の「ファイルの URL へのアクセスを許可する」を案内する。

### one-time / POST response PDF

元URLを再fetchできないPDFは標準Viewer + URL再取得方式では取り込めない可能性がある。このケースが重要になった場合のみ別方式を検討する。

---

## 10. Context Menu

登録項目:

```text
Deep Readerで深掘り
Deep Readerの引用に追加
```

Background側は `contextMenus.onClicked` の `selectionText` と `pageUrl` を共通capture pipelineへ渡す。

Context menu登録は起動時のraceを避けて直列化し、onInstalled/onStartup/mainから重複実行されても破綻しないようにする。

ネイティブcontext menu自体のクリックはOS Accessibility/TCCの影響を受けるため、通常の自動E2Eとは分離した最終スモーク対象とする。

---

## 11. Headless E2E方針

Extension E2Eは **Chrome Headlessを既定** とする。

```bash
npm run e2e:extension:live
npm run e2e:extension:real -- /path/to/book.pdf
```

`e2e/chrome-launch.mjs` は通常Chromeの統合Headlessを `headless: true` で起動し、WXT production extensionを読み込む。画面表示が必要な明示的診断時のみ次を使う。

```bash
DEEP_READER_E2E_HEADLESS=0 npm run e2e:extension:live
```

Apple Silicon上でx64 Nodeから起動された場合は、Chrome/Puppeteer制御プロセスだけarm64 Nodeへ切り替え、Server processは既存Nodeを維持する。実インストール済みChromeを優先し、Puppeteer専用Chrome cacheへの依存を避ける。

Headless E2Eの対象:

```text
WXT production build
→ Extension Service Worker
→ Chrome built-in PDF Viewer
→ PDF viewer selected text
→ Side Panel
→ capture/import/index
→ selection再同定
→ Source表示
→ real Codex App Server turn
→ Progressive Context Expansion
→ citation navigation
→ Insight保存/編集/version diff
→ 複数Deep Dive
→ file:// PDF
→ duplicate selection ambiguity
→ tab state isolation
→ same-tab PDF document switch reset
→ Cookie認証PDF
→ Server停止状態からNative Messagingオンデマンド起動
→ Native Host起動要求のidempotency
→ server startup failure UI
```

実機表示は、ネイティブcontext menu操作や目視UX確認など、Headlessでは意味のない確認に限定する。

---

## 12. 開発・診断

Chrome拡張開発はServerとWXTを一括起動できる。

```bash
npm run dev:chrome
```

環境診断:

```bash
npm run doctor:extension
npm run native-host:status
```

初回Native Host登録:

```bash
npm run native-host:install
```

診断にはHost architecture、Node architecture、Chrome path、Headless default、arm64 fallbackに加え、Native Host manifest・固定Extension ID・allowed originの一致を確認する。

---

## 13. 権限方針

Manifest権限:

```text
contextMenus
storage
tabs
activeTab
sidePanel
nativeMessaging
```

常時必要なhost permission:

```text
http://127.0.0.1/*
file:///*
```

127.0.0.1はDeep Reader Server専用。任意Web PDFはcontext menuという明示的ユーザー操作と`activeTab` grantを前提にする。

---

## 14. Cutover gate

Chrome版のrelease gateは次とする。

1. `npm run check`
2. `npm run test:native-host` でServer停止→Native Host起動→healthをPASS
3. `npm run e2e:extension:native-startup` でChrome Extension → Native Messaging → Server起動をHeadless PASS
4. `npm run e2e:extension:live` をHeadlessでPASS
5. 任意の実PDFを `npm run e2e:extension:real -- <pdf>` でHeadless PASS
6. native context menuの実ユーザースモーク
7. Side Panelの目視UX確認

自動化可能な項目はHeadlessを既定とし、人間の画面操作をE2E成功条件へ混在させない。
