# Deep Reader

技術書 PDF を「全文 AI に渡す」のではなく、**Chrome で読んでいる箇所を根拠に、その場で深掘りする**ためのローカル読書ツールです。

Chrome 標準 PDF Viewer をそのまま使い、Deep Reader は Side Panel として動作します。PDF の表示・検索・ズーム・印刷・ダウンロード等は Chrome に委譲し、Deep Reader は選択箇所の再同定、書籍内検索、Codex との対話、Insight 保存に集中します。

## 主な機能

- Chrome 標準 PDF Viewer の選択テキストを `SourceAnchor` として保存
- 1 回の質問に複数箇所を添付
- 必要な場合だけ、前後 block → section → 書籍内検索へ追加参照
- AI が追加取得した本文を user-selected source と区別して記録
- 回答中の引用から元 PDF ページへ戻る
- 複数の Deep Dive thread
- 回答を `Insight` として保存し、version history と根拠を保持
- Mermaid と allow-list 型 Visualization DSL による図解
- PDF、索引、会話、Insight はローカル保存
- `codex app-server` を stdio で利用

中心となる概念は次の 3 つです。

```text
SourceAnchor   原文の根拠
Deep Dive      考えるための対話
Insight        残すための知識成果物
```

## 構成

```text
Chrome built-in PDF Viewer
        │ selection / context menu
        ▼
Deep Reader Chrome Extension (WXT + React Side Panel)
        │ Bearer capability / localhost HTTP
        ▼
Deep Reader Local Server (Fastify + SQLite)
        │ stdio / JSONL
        ▼
codex app-server
```

Local Server はログイン時常駐ではありません。Extension が必要になった時だけ Native Messaging Host を介してオンデマンド起動します。

Server 起動ごとにランダムな local capability token を生成し、`/api/health` 以外の localhost API を保護します。token は Native Messaging 経由で Extension に渡し、Extension 側では `chrome.storage.session` にのみ保持します。

## 必要環境

- macOS
- Google Chrome 141 以上
- Node.js 22.13.0 以上
- 検証基準: Node.js 22.23.2 (`.node-version`)
- ChatGPT/Codex に認証済みのローカル環境

`codex app-server` の生 protocol を Browser へ公開せず、Local Server が狭いアプリ API と read-only book tools に変換します。

## 開発セットアップ

```bash
npm install
npm run build
npm run native-host:install
```

Chrome の `chrome://extensions` でデベロッパーモードを有効にし、次のディレクトリを「パッケージ化されていない拡張機能」として読み込みます。

```text
apps/chrome-extension/.output/chrome-mv3
```

以後は PDF を Chrome で開き、本文を選択してコンテキストメニューから Deep Reader を起動できます。

開発時は次で Server と WXT を同時起動できます。

```bash
npm run dev
```

## Server / Native Host 診断

```bash
npm run server:status
npm run server:start
npm run server:stop
npm run server:restart

npm run native-host:status
npm run native-host:install
npm run native-host:uninstall
npm run doctor:extension
```

Native Host は daemon / KeepAlive / Login Item ではなく、Chrome から必要な時だけ起動される launcher です。

## 検証

通常の品質ゲート:

```bash
npm run check
```

Chrome Extension の主要 E2E:

```bash
npm run test:native-host
npm run e2e:extension:native-startup
npm run e2e:extension:live
npm run e2e:extension:real -- /path/to/book.pdf
```

`e2e:extension:live` は実 Codex App Server を利用して、PDF import/index、selection 再同定、AI 追加参照、citation navigation、Insight、複数 thread、複数 tab、Cookie 認証 PDF、`file://` PDF、Server 障害表示まで Headless Chrome で検証します。

## リポジトリ構成

```text
apps/
  chrome-extension/   Chrome MV3 / WXT / React Side Panel
  server/             Fastify / SQLite / PDF index / Codex adapter
packages/
  shared/             API / domain schema
  visualization/      safe visualization schema / renderer
scripts/              server, native host, release-support utilities
e2e/                  Chrome Extension E2E
docs/                 現行仕様
assets/               branding / release artwork
```

## ドキュメント

- [製品仕様](docs/product-spec.md)
- [アーキテクチャ](docs/architecture.md)
- [UI・可視化仕様](docs/ui-and-visualization.md)
- [Insight / Context Retrieval仕様](docs/insights-and-context-retrieval.md)

完了済みの実装計画、移行評価、自己レビュー記録は現行仕様へ反映後、公開リポジトリには保持しません。Git history が変更履歴の正本です。

## Security / Privacy / License

- [Security Policy](SECURITY.md)
- [Privacy Policy](PRIVACY.md)
- [Apache License 2.0](LICENSE)
- [Third-party notices](THIRD_PARTY_NOTICES.md)

第三者ライセンス一覧は production dependency tree から再生成できます。

```bash
npm run licenses:generate
```

## アイコン

編集原本は `assets/branding/icon-source.png` です。Chrome 用・Release 用 PNG は手修正せず生成します。

```bash
npm run icons:generate
```

生成先:

- Chrome Extension: `apps/chrome-extension/public/icons/icon-{16,32,48,128}.png`
- Release artwork: `assets/release/deep-reader-icon-{256,512,1024}.png`

生成時に原本の黒い外周マットを透明化してから縮小します。
