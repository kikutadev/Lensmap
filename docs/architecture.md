# アーキテクチャ

## 1. 全体構成

Lensmap の公開版は Chrome Extension + Local Server の1経路とする。

Map構造化とCodex Skill / Dynamic Toolの設計判断は [`ADR-001: Structured Map Composition`](adr/ADR-001_structured-map-composition.md) を正とする。

```text
Chrome built-in PDF Viewer
        │ selection/context menu
        ▼
WXT Background Service Worker ───── Side Panel (React)
        │                                   │
        ├──── Native Messaging ─────────────┤ startup/capability
        │                                   │
        ▼                                   ▼
com.lensmap.launcher              localhost HTTP API
        │                                   │
        └────────── start ────────────┐      │
                                      ▼      ▼
                                Local App Server
                                Fastify / SQLite
                                      │
                                      ├─ Reader Workspace
                                      ├─ PDF index / SourceAnchor
                                      ├─ Map / Explore persistence
                                      └─ Codex adapter
                                              │ stdio / JSONL
                                              ▼
                                      codex app-server
```

Chrome 標準 PDF Viewer の private DOM/API を製品実装から利用しない。Context menu から受け取った selection text を Local Server の PDF index へ再同定する。

## 2. 所有関係

製品状態の所有単位は Chrome Tab ではなく `ReaderWorkspace` とする。

```text
ReaderWorkspace
 ├─ workspace_books -> Books
 ├─ Explore Threads
 ├─ active References / UI state
 └─ Maps provenance
```

Chrome Tab は次の用途に限定する。

- PDF の表示
- Source capture時のbrowser context
- citation navigation時の移動先候補

active tab の変更で Workspace / Thread / draft / streaming state を自動切替しない。

## 3. Monorepo

```text
apps/
  chrome-extension/
  server/
    skills/
      lensmap-map-composer/
packages/
  shared/
  visualization/
scripts/
e2e/
docs/
assets/
```

- `apps/chrome-extension`: WXT / React / Side Panel / background worker
- `apps/server`: Fastify / SQLite / Reader Workspace / PDF index / Codex adapter / built-in Codex Skills
- `packages/shared`: API・domain schema
- `packages/visualization`: allow-list Visualization DSL

## 4. PDF ingestion / indexing

PDF の表示は Chrome に任せるが、選択箇所の再同定と書籍内 retrieval のため、Server は PDF をローカル管理領域へ import する。

`pdfjs-dist` は **Server 側の抽出・索引用途**で使用する。

```text
Original PDF URL
  ↓ Extension fetch (browser credentials)
PDF bytes
  ↓ POST /api/books/import
Managed PDF copy
  ↓ pdfjs-dist
Physical spans / rects
  ↓ structure inference
Document blocks / sections
  ↓
FTS5 retrieval index
```

同一内容は SHA-256 fingerprint で重複判定する。改訂版は別 Book とする。同じ PDF を複数 Chrome tab で開いても fingerprint が同じなら同じ Book へ解決する。

## 5. Selection再同定 / Workspace routing

Context menu から得られる selection text は PDF page 情報を含まないため、Server が次を使って候補を再構築する。

- raw / normalized quote
- exact occurrence
- prefix / suffix
- page/block text
- stable document block IDs

一意候補なら SourceAnchor を作成し、複数候補なら Side Panel に候補を返す。

SourceAnchor の Physical Layer は Semantic Layer の成功可否に依存させない。

Visual SourceではChrome PDF Viewerのprivate DOMへoverlayを注入しない。`captureVisibleTab()`でvisible viewportを一時captureし、Extension所有のCapture Surfaceで矩形選択する。crop画像を一次資産として保存し、full viewport captureはcommit/cancel後に破棄する。OCRとmanaged PDF renderとのalignmentによりpage / page rectを可能な範囲で再同定する。詳細は [`visual-source-capture.md`](visual-source-capture.md) を参照する。

Capture後のSourceは現在選択中のWorkspaceへ追加する。Workspace未選択時は初回captureでWorkspaceを自動作成する。

## 6. Context / Retrieval

`ContextBuilder` は user-selected Source を最優先する。書籍全文は暗黙に追加しない。

AI の追加参照は Workspace-aware な read-only tool surface に限定する。

概念上のtool:

```text
workspace_expand_source
workspace_search
workspace_read_blocks
workspace_list_sections
workspace_read_section
```

`workspace_search` はWorkspace内Booksを横断し、必要なら `bookIds` で対象を限定できる。

比較・因果・定義・設計意図・章全体との関係・統合質問では、明示Sourceだけで表面的に答えられる場合でも、有用ならnearby / section / searchを行うinstructionとする。

検索結果候補は citation source ではない。実際に本文またはVisual Source画像をmodel inputへ渡した時点で `ai-expansion` SourceAnchor として materialize する。Visual SourceのOCRは検索hintとして利用できるが、画像の代替とはみなさない。

通常 Context Budget と追加探索の Expansion Budget を分離する。

## 7. Retrieval audit

Turn単位で次を記録する。

- 対象 Workspace / Book
- search query
- candidate block
- 実際に read した block
- materializeした `ai-expansion` SourceAnchor
- citationへ昇格したSource
- Expansion Budgetによるtruncation

通常UIにはraw tool JSONを表示せず、人間向けsummaryへ変換する。Debug/advanced surfaceでは詳細auditを確認可能にする。

## 8. Codex adapter

`codex app-server` は Local Server が子processとして stdio transport で起動する。Browser へ Codex protocol を直接公開しない。

Adapter はアプリが利用する狭い protocol 面だけを Zod で runtime validation する。巨大な自動生成 protocol bindings は通常buildへ含めない。

LensmapはApp ServerのSkill discoveryへbuilt-in Skill rootを登録し、`lensmap-map-composer` をReader threadから利用可能にする。起動時に `skills/extraRoots/set` でrootを登録し、`skills/list` でdiscoveryをhealth checkする。Map構造化のdecision tableやexamplesはbase promptへ重複せずSkillをSSOTとする。

Explore thread は次の防御を持つ。

- approval policy: `never`
- sandbox: read-only
- Lensmap専用base instructions
- configured MCP / Apps / Web searchをreader用途から分離
- Lensmap workspace retrieval toolsと、非永続の `lensmap_compose_map` Map Draft提出toolだけを model-visible にする

Codex modelはThread defaultとして保存する。model変更はThreadを作り直さず、次Turnから適用する。Visual Sourceを含むTurnでは`model/list`のinput modalityを確認し、`image`非対応modelへOCR-onlyで黙って送信しない。画像対応modelではCodex App Serverの`localImage`入力を利用する。

`lensmap_compose_map` はDB writeを行わず、per-turn memoryへZod検証済みMap Draftを提出するだけとする。Turn完了後にMapServiceがDraftをMapArtifactへmaterializeし、Draftがない場合だけMarkdown parserへfallbackする。これによりMap自動保存・冪等性を維持したまま、主要経路をMarkdown再解釈から分離する。

利用状況は以下のCodex App Serverデータを使う。

- model list: `model/list`
- Context: `thread/tokenUsage/updated`
- account rate limits: `account/rateLimits/read`

## 9. Local API security

Server は既定で `127.0.0.1` のみに bind する。

Production controller は起動ごとに256-bit capability tokenを生成する。

```text
.runtime/capability-token   mode 0600
        │
        ▼
Native Messaging Host
        │
        ▼
Extension chrome.storage.session
        │
        ▼
Authorization: Bearer <capability>
```

- `/api/health` は起動判定のため認証不要
- その他の production API は capability 必須
- token はログ・Git・persistent extension storageへ出さない
- Server再起動後の401ではExtensionがcapabilityを再同期する

Chrome permissions は build後manifestを allow-list 検査する。現行 permission は以下のみ。

```text
activeTab
contextMenus
nativeMessaging
sidePanel
storage
```

host permissions:

```text
http://127.0.0.1/*
file:///*
```

任意Web PDFへの恒常的host permissionは持たず、ユーザー操作に伴う `activeTab` grantを利用する。Visual Captureの`captureVisibleTab()`も明示的なユーザー操作中の`activeTab` grantで行い、Visual Source追加のためだけに広域host permissionを増やさない。

## 10. Native Messaging startup

Local Server はログイン時常駐させない。

```text
Lensmap action
  ↓
GET /api/health
  ├─ protected server running → capability取得/利用
  └─ stopped or legacy unprotected server
        ↓
      sendNativeMessage(com.lensmap.launcher)
        ↓
      production server controller
        ↓
      protected server ready
```

Native Host はdaemonではなく1 requestで終了する薄いlauncherとする。

## 11. Persistence

SQLite + Drizzle を利用する。PDF binaryはDB BLOBではなくmanaged fileとして保存する。

主要データ:

- `reader_workspaces` / `workspace_books`
- books / page / document block / retrieval index
- source anchors / visual source assets
- `explore_threads` / `explore_turns` / source provenance
- `map_artifacts` / `map_versions` / `map_blocks` / provenance

Explore Threadの所有キーは `workspace_id` とする。MapArtifactが参照するBook集合は `map_sources -> source_anchors -> books` から導出し、単一 `primaryBookId` をauthorityにしない。

初回リリース前のため、正式schemaは `explore_*` / `map_*` を正とし、旧 `chat_*` / `insight_*` aliasを残さない。既存開発DBの移行・再生成方針は実装planで管理する。

Runtime log、PID、capability、実PDF、SQLite DBはGit管理対象外とする。

## 12. Frontend state

- Server state: TanStack Query
- active Workspace / active Thread / transient UI state: Zustand + 必要なpersistent storage
- current tab/document metadata: `chrome.storage.local`
- display locale preference (`system | en | ja`): `chrome.storage.local`
- capability: `chrome.storage.session`

Extension localizationは`@wxt-dev/i18n/module`を使用し、`apps/chrome-extension/locales/en.json` / `ja.json`を翻訳SSOTとする。Manifestは`__MSG_*__`、React surfaceは共通runtime、静的HTML surfaceは`data-i18n` localizerを通す。明示locale override時も同じcatalogを参照し、background context menuを含めてstorage changeへ追従する。

active tab/document stateとWorkspace stateを分離する。

同一tabでPDF URLが変わっても、変更するのはそのtabのDocument View metadataだけとし、Workspace / Explore Threadをresetしない。draft / streaming stateはThread単位に保持する。

## 13. Citation navigation

Citationは `sourceAnchorId / bookId / page / quote` から解決する。

1. 同一Book/PDFを表示中のtabを探索
2. 見つかればactivate
3. なければPDFを新規tabで開く
4. `#page=N` へnavigate

Chrome標準PDF Viewerを維持するため、rect単位highlightは保証しない。quote previewをLensmap側のcitation UIで表示する。

## 14. Visualization security

Markdownは `react-markdown` + sanitize、Mermaidはstrict mode、独自図解は `@lensmap/visualization` の Zod schemaを通ったJSONだけを描画する。

任意 JSX / JavaScript / HTML を実行しない。図表描画失敗はblock-local errorとして扱い、回答全体を壊さない。
