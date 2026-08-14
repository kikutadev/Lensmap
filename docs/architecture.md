# アーキテクチャ

## 1. 全体構成

Deep Reader の公開版は Chrome Extension + Local Server の1経路とする。

```text
Chrome built-in PDF Viewer
        │ selection/context menu
        ▼
WXT Background Service Worker ───── Side Panel (React)
        │                                   │
        ├──── Native Messaging ─────────────┤ startup/capability
        │                                   │
        ▼                                   ▼
com.deepreader.launcher              localhost HTTP API
        │                                   │
        └────────── start ────────────┐      │
                                      ▼      ▼
                                Local App Server
                                Fastify / SQLite
                                      │
                                      ├─ PDF index / SourceAnchor
                                      ├─ Insight / Chat persistence
                                      └─ Codex adapter
                                              │ stdio / JSONL
                                              ▼
                                      codex app-server
```

Chrome 標準 PDF Viewer の private DOM/API を製品実装から利用しない。Context menu から受け取った selection text を Local Server の PDF index へ再同定する。

## 2. Monorepo

```text
apps/
  chrome-extension/
  server/
packages/
  shared/
  visualization/
scripts/
e2e/
docs/
assets/
```

- `apps/chrome-extension`: WXT / React / Side Panel / background worker
- `apps/server`: Fastify / SQLite / PDF index / Codex adapter
- `packages/shared`: API・domain schema
- `packages/visualization`: allow-list Visualization DSL

## 3. PDF ingestion / indexing

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

同一内容は SHA-256 fingerprint で重複判定する。改訂版は別 Book とする。

## 4. Selection再同定

Context menu から得られる selection text は PDF page 情報を含まないため、Server が次を使って候補を再構築する。

- raw / normalized quote
- exact occurrence
- prefix / suffix
- page/block text
- stable document block IDs

一意候補なら SourceAnchor を作成し、複数候補なら Side Panel に候補を返す。

SourceAnchor の Physical Layer は Semantic Layer の成功可否に依存させない。

## 5. Context / Retrieval

`ContextBuilder` は user-selected Source を最優先する。書籍全文は暗黙に追加しない。

AI の追加参照は `BookContextGateway` 経由の read-only tool に限定する。

```text
book_expand_source
book_search
book_read_blocks
book_list_sections
book_read_section
```

検索結果候補は citation source ではない。実際に本文を read した時点で `ai-expansion` SourceAnchor として materialize する。

通常 Context Budget と追加探索の Expansion Budget を分離する。

## 6. Codex adapter

`codex app-server` は Local Server が子processとして stdio transport で起動する。Browser へ Codex protocol を直接公開しない。

Adapter はアプリが利用する狭い protocol 面だけを Zod で runtime validation する。巨大な自動生成 protocol bindings は通常buildへ含めない。

Reader thread は次の防御を持つ。

- approval policy: `never`
- sandbox: read-only
- Deep Reader専用base instructions
- configured MCP / Apps / Web searchをreader用途から分離
- Deep Reader book toolsだけを model-visible にする

## 7. Local API security

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

任意Web PDFへの恒常的host permissionは持たず、ユーザー操作に伴う `activeTab` grantを利用する。

## 8. Native Messaging startup

Local Server はログイン時常駐させない。

```text
Deep Reader action
  ↓
GET /api/health
  ├─ protected server running → capability取得/利用
  └─ stopped or legacy unprotected server
        ↓
      sendNativeMessage(com.deepreader.launcher)
        ↓
      production server controller
        ↓
      protected server ready
```

Native Host はdaemonではなく1 requestで終了する薄いlauncherとする。

## 9. Persistence

SQLite + Drizzle を利用する。PDF binaryはDB BLOBではなくmanaged fileとして保存する。

主要データ:

- books
- page / document block / retrieval index
- source anchors
- chat threads / messages / source provenance
- insight artifacts / versions / blocks / provenance

Runtime log、PID、capability、実PDF、SQLite DBはGit管理対象外とする。

## 10. Frontend state

- Server state: TanStack Query
- tab/document state: `chrome.storage.local`
- capability: `chrome.storage.session`
- transient Side Panel state: Zustand

同一tabでPDF URLが変わった場合は、Source / thread / assistant等のdocument-bound stateをresetする。Streaming、draft等の一時stateもtab単位で分離する。

## 11. Visualization security

Markdownは `react-markdown` + sanitize、Mermaidはstrict mode、独自図解は `@deep-reader/visualization` の Zod schemaを通ったJSONだけを描画する。

任意 JSX / JavaScript / HTML を実行しない。図表描画失敗はblock-local errorとして扱い、回答全体を壊さない。
