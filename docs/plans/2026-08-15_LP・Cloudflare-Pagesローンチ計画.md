# Lensmap LP・Cloudflare Pagesローンチ計画

Date: 2026-08-15
Status: Planned

## 1. Goal

Lensmap の公開用 Landing Page を Astro で実装し、Cloudflare Pages へ継続デプロイ可能な状態にしたうえで、`https://lensmap.kikuta.dev` を production URL として公開する。

LP は一般的な「AI PDF 要約ツール」の紹介ページにはしない。`docs/concept.md` を上位 SSOT とし、Lensmap 固有の価値である以下を数秒で理解できることを最優先とする。

> 気になった一節から、理解の地図をつくる。

```text
Read → Focus → Explore → Map → Return to reading
```

> AI is the lens. The map is the outcome.

ローンチ完了条件は「HTML が公開された」ことではなく、以下までを含む。

1. Lensmap の価値が初見で理解できる production-quality LP が存在する。
2. 実製品の UI / Map を一次素材として見せ、架空のモックで誤認させない。
3. ローカルで検証済みの静的 build を Wrangler CLI から Cloudflare Pages preview / production へ明示的に deploy できる。
4. `lensmap.kikuta.dev` で HTTPS 配信される。
5. desktop / mobile、light / dark、accessibility、SEO、OG、performance を本番 URL で受入確認する。

---

## 2. Current state / constraints

### 2.1 Existing SSOT

LP のコピー・情報設計・ビジュアル原則は新規に独立して定義せず、以下を参照する。

- `docs/concept.md`
- `docs/design-system.md`
- `docs/product-spec.md`
- `docs/ui-and-visualization.md`
- `README.md`
- `PRIVACY.md`
- `SECURITY.md`
- `LICENSE`

特に次を LP でも不変条件とする。

- Reading stays primary
- Start from human attention
- Expand context deliberately
- Every durable insight is traceable
- Conversation is process; Map is the automatically retained outcome
- Local-first by default
- AI を gradient / glow で表現しない
- Apple HIG の pixel copy ではなく、hierarchy / typography / spacing / motion / accessibility を Web へ翻訳する

### 2.2 Repository

Lensmap は npm workspaces の monorepo である。

```text
apps/
  chrome-extension/
  server/
packages/
  shared/
  visualization/
```

LP は別リポジトリへ分離せず、同一製品の公開 surface として次へ追加する。

```text
apps/
  landing-page/
```

理由:

- product copy / branding / screenshot を本体と同じ commit で同期できる
- Privacy / Security / README との drift を防げる
- Cloudflare Pages は monorepo を正式に扱える
- 小規模な LP のためだけに repository / dependency management を分離するメリットが薄い

### 2.3 Repository publication / local path

公開前にローカル repository directory をブランドと一致する次へ変更する。

```text
/Users/kiku28/pj/apps/Lensmap
```

GitHub は `kikutadev/Lensmap` を正規 repository とする。2026-08-16 に secret / local-data / history scan を通過し、Public repository として作成・`main` push 済み。

Public 化前の必須条件:

- real PDF / SQLite / runtime data が Git history に存在しない
- `.env` 実体、private key、API token、credential が history に存在しない
- tracked docs / fixtures に private customer/work data が存在しない
- Git author metadata は GitHub noreply email を使い、非公開 email を不必要に露出しない
- `LICENSE` / `THIRD_PARTY_NOTICES.md` / `SECURITY.md` / `PRIVACY.md` が存在する

GitHub push と Pages deployment は分離する。GitHub は source distribution / release / collaboration の正本、Cloudflare Pages は **CLI Direct Upload** を production deployment path とする。

---

## 3. Technical architecture

### 3.1 Astro mode

LP は **Astro static output** を採用する。

初期リリースでは SSR / Pages Functions / KV / D1 / Workers binding を導入しない。

理由:

- LP の内容は build-time に確定できる
- JavaScript runtime を最小化できる
- Cloudflare Pages の `dist` static deploy と相性が良い
- 運用・障害面を単純化できる
- 将来必要になった場合のみ island / server runtime を追加できる

したがって初期段階では `@astrojs/cloudflare` adapter を必須にしない。Cloudflare adapter は SSR / runtime 機能が必要になった時点で採否を再判断する。

### 3.2 Package layout

想定:

```text
apps/landing-page/
  astro.config.mjs
  package.json
  tsconfig.json
  public/
    favicon.*
    robots.txt
    _headers
  src/
    assets/
    components/
    layouts/
    pages/
      index.astro
      en/
        index.astro
    styles/
```

root `package.json` の `workspaces: ["apps/*", "packages/*"]` にそのまま参加させる。

LP 単体で以下を実行できるようにする。

```bash
npm run dev -w @lensmap/landing-page
npm run build -w @lensmap/landing-page
npm run check -w @lensmap/landing-page
```

### 3.3 Cloudflare Pages deployment — CLI Direct Upload

Cloudflare Pages の Git integration は使用せず、**Wrangler Direct Upload** を採用する。

理由:

- production deploy を「Git push の副作用」にせず、受入済み build を明示的に release できる
- LP と product repository の commit cadence を分離できる
- preview / production の deploy 対象を CLI で明確にできる
- static Astro のため remote build infrastructure を必要としない

Cloudflare Pages の Direct Upload project は後から同一 project を Git integration へ切り替えられないため、これは意図的な project-level decision とする。自動 deploy が必要になった場合は GitHub Actions 等から同じ Wrangler Direct Upload command を呼ぶか、新しい Pages project への移行を別途判断する。

再現性のため Wrangler は package dependency として version pin し、手元の global install に依存しない。

想定 root scripts:

```text
npm run lp:dev
npm run lp:build
npm run lp:check
npm run lp:deploy:preview -- --branch=<name>
npm run lp:deploy:production
```

production の本質的な command は次とする。

```bash
npm run build -w @lensmap/landing-page
npx wrangler pages deploy apps/landing-page/dist \
  --project-name=lensmap \
  --branch=main
```

初回のみ:

```bash
npx wrangler pages project create lensmap --production-branch=main
```

実際の script では build / check / output existence / git dirty-state policy / deployment result verification をまとめ、`deploy` 単体を人が手打ちする必要を減らす。

### 3.4 Custom domain automation

`lensmap.kikuta.dev` の custom-domain association は Cloudflare Pages Domains API で自動化可能なので、CLI launch workflow から切り離した dashboard-only 手順にはしない。

一回性の control-plane setup として `scripts/configure-lp-domain.mjs` 等を用意し、以下を冪等に確認・設定する。

1. Pages project `lensmap` の存在
2. `lensmap.kikuta.dev` の domain association
3. 必要な DNS record / validation state
4. domain status が `active` であること

credential は Git 管理しない。Wrangler login / Cloudflare API token の既存認証を優先し、API token が必要な実装では environment variable からのみ受け取る。

---

## 4. Information architecture

LP は機能一覧を先に見せず、読書中の「気になる一節」から価値を理解させる。

### 4.1 Header

- Lensmap brand / icon
- `How it works`
- `Maps`
- `Privacy`
- `GitHub`
- language switch `日本語 / EN`
- primary CTA: `Lensmap を入手`

ナビゲーションは compact にし、常時 glass / floating pill を多用しない。

### 4.2 Hero

Primary copy:

> 気になった一節から、理解の地図をつくる。

Supporting copy:

> PDF を読みながら選んだ箇所を起点に文脈を掘り、根拠付きの理解を図解として残すローカル読書ツール。

Hero visual は架空の dashboard ではなく、実際の Chrome PDF Viewer + Lensmap Side Panel の画面を使用する。

見せたい一連の状態:

```text
PDF passage selected
      ↓
Explore
      ↓
Grounded response / visual
      ↓
Map saved automatically
```

Hero 内で情報を詰め込みすぎず、「何を選び、何が返り、何が残るか」が一目で読める静止画または軽量な staged visual を第一候補とする。

### 4.3 Core loop — Focus / Expand / Map

3つの generic feature card を並べるのではなく、1つの読書例を横断する flow として示す。

#### Focus

- 自分が気になった一節・図表から始める
- PDF 全体の自動要約から始めない

#### Expand

- 選択箇所だけで足りなければ前後・節・関連箇所へ広げる
- 何を追加で読んだか追跡できる

#### Map

- 回答は自動保存される
- 図、表、比較、説明など内容に合った形で理解が残る
- 根拠から PDF 原文へ戻れる

### 4.4 Map showcase

Lensmap の差別化を最も強く見せるセクション。

最低 3 種類の実例を用意する。

候補:

1. Architecture / relationship map
2. Comparison / table map
3. Process / sequence map

「Mermaid generator」に見えないよう、図だけでなく explanation + evidence + PDF backlink の組み合わせまで画面内で示す。

### 4.5 Grounded / traceable

訴求:

- 根拠のない AI note を大量生成するのではない
- user-selected reference と AI-added reference を区別する
- Map から原文へ戻れる

citation / Evidence UI の実画面を使う。

### 4.6 Local-first / privacy

強い安心材料だが Hero の主語にはしない。

明示する内容:

- PDF / index / Explore / Maps はローカル保存が基本
- AI へ送るのは質問と必要な reference/context に限定
- ログイン時常駐 server ではなく必要時オンデマンド起動

詳細は `PRIVACY.md` へリンクする。

### 4.7 Installation / availability

現行製品仕様に合わせ、Chrome Web Store であるかのように見せない。

公開形態:

- GitHub Releases
- macOS Apple Silicon
- Chrome 141+
- ChatGPT Mac app または Codex CLI 側で認証済み

CTA は実際の Release availability と同期する。

初回 release がまだ存在しない段階では、存在しない download URL を先に公開しない。production launch は release asset と CTA が実際につながることを gate とする。

### 4.8 Footer

- GitHub
- Privacy
- Security
- License
- English / Japanese

不要な company boilerplate や SaaS pricing を置かない。

---

## 5. Visual direction

### 5.1 Principle

LP も Lensmap 本体と同じく「AI SaaS landing page」の定型表現を避ける。

避けるもの:

- purple / blue neon gradient
- glowing AI orb
- excessive glass cards
- dashboard mockup の羅列
- feature badge / pill の乱用
- 意味のない scroll animation
- lorem ipsum 的な架空 Map

採用するもの:

- system typography
- restrained neutral surfaces
- product screenshot を大きく扱う
- generous whitespace
- content / controls の depth を分ける
- subtle separators
- light / dark appearance
- Lensmap の実 Map を graphic identity として使う

### 5.2 Typography

本体 design system と揃える。

```css
font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif;
```

SF Pro font file は同梱しない。

Marketing page として body size は本体 Side Panel より大きくし、desktop では 16–18px 程度を基準に読みやすさを優先する。

### 5.3 Motion

必要最小限とする。

候補:

- hero product frame の restrained entrance
- Focus → Expand → Map の状態遷移
- Map preview の hover / focus feedback

`prefers-reduced-motion` では非本質 motion を無効化する。

---

## 6. Product media strategy

LP の品質は実製品の screenshot / Map sample に強く依存するため、ここを独立した production task とする。

Spex の `marketing/image` は、**実UIを自動 capture → deterministicなmarketing assetへ変換 → QA用縮小版で検証 → LPへ同期**という考え方を参照する。ただし Lensmap の初期LPでは静止画が中心であり、Remotion は導入しない。

### 6.1 Source of truth

- 実際の Lensmap production build を使う
- actual PDF / actual Map render を使う
- Figma風の架空 UI は作らない
- capture の再現に既存 Puppeteer E2E infrastructure を優先して再利用する

### 6.2 Rendering strategy — CSS first, image generation only where useful

用途ごとに最も軽い手段を使う。

**Web page上のHero / showcase**

- 原則は raw product screenshot + Astro/CSS composition
- browserで表現できる framing / shadow / annotation をわざわざ1枚の画像へ焼き込まない
- responsive layout とdark/light対応を保持する

**固定サイズの配布画像**

対象:

- Open Graph 1200x630
- GitHub / release artwork が必要になった場合
- 複数画面を1枚に構成した方が伝わる限定的なmarketing still

これらだけは Node script で deterministic に画像生成する。第一候補は repository に既に存在する `@napi-rs/canvas` を利用し、必要なら SVG を中間表現にする。動画timeline / React compositionを必要としないため Remotion は採用しない。

この方針により追加dependencyとrender時間を抑えながら、Spexで有効だった「captureとmarketing compositionを分離する」利点だけを残す。

### 6.3 Screenshot states

最低限取得する。

1. Chrome PDF Viewer + Lensmap Explore
2. user-selected reference shelf
3. AI-added context / evidence disclosure
4. visual Map library
5. Map detail + evidence / backlink
6. light appearance
7. dark appearance

Hero と showcase で同じ screenshot を使い回しすぎない。

### 6.4 Asset pipeline

想定:

```text
production Lensmap
      ↓ Puppeteer capture
assets/marketing/captures/*.png
      ↓
      ├─ Astro/CSSでLPへ直接利用
      └─ @napi-rs/canvasでOG等の固定画像を生成
             ↓
       apps/landing-page/public/og/*
```

生成scriptは次を満たす。

- exact dimensions の検証
- expected source capture の存在確認
- stale output の検知
- deterministic output path
- QA用preview / contact sheet が有用なら生成

### 6.5 Asset optimization

- source PNG は必要なものだけ repo に保持
- Web delivery は Astro image pipeline で適切なサイズへ生成
- AVIF / WebP を優先し fallback を持つ
- screenshot の読める解像度を維持する
- hero image を oversized のまま配信しない

---

## 7. Localization

初回 launch から日本語 / 英語の 2 言語を対象とする。

URL:

```text
/       Japanese primary
/en/    English
```

理由:

- Concept Doc に canonical Japanese / English phrase が既に存在する
- OSS / GitHub Release として海外ユーザーも自然な対象になる
- root で JS language redirect を行うより URL が明示的で安定する

`hreflang` / canonical を適切に出力する。

翻訳は単なる逐語訳ではなく、Concept Doc の canonical English を優先する。

---

## 8. SEO / social metadata

最低限実装する。

- `<title>`
- meta description
- canonical
- `hreflang`
- Open Graph
- Twitter/X card metadata
- favicon / apple-touch-icon
- `robots.txt`
- sitemap
- structured data は実態と有用性がある `SoftwareApplication` 程度に限定

OG image は Lensmap icon だけではなく、tagline + actual Map/product surface を使った dedicated artwork を作る。

公開前に SNS debugger 相当で OG rendering を確認する。

---

## 9. Security / privacy / dependency policy

静的 LP のため、初期 launch では analytics / cookie / external tracking script を置かない。

これにより cookie banner を不要にし、Local-first のブランドメッセージとも整合させる。

外部 font CDN も使わない。

必要に応じて `_headers` で以下を設定する。

- `Content-Security-Policy`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy`
- `Permissions-Policy`

CSP は OG / image / GitHub link 等の実利用を壊さない最小許可で構成する。

---

## 10. Testing / acceptance

### 10.1 Static validation

- Astro build succeeds
- TypeScript / Astro check succeeds
- broken internal links なし
- duplicate heading / invalid landmarks なし
- missing alt text なし
- no console error

### 10.2 Responsive visual acceptance

最低限:

- 320px
- 390px
- 768px
- 1024px
- 1440px+

確認対象:

- Hero copy が screenshot を押し潰さない
- horizontal overflow なし
- Maps sample の文字が読める
- navigation / CTA の touch target が十分
- long Japanese / English copy 双方で layout が破綻しない

### 10.3 Appearance

- light
- dark
- system preference follow
- reduced motion

### 10.4 Accessibility

- semantic landmarks
- heading order
- keyboard navigation
- visible focus
- contrast
- alt text
- motion reduction

### 10.5 Performance target

本番 URL の Lighthouse を基準とする。

Target:

```text
Performance: >= 95 desktop / >= 90 mobile
Accessibility: >= 95
Best Practices: >= 95
SEO: >= 95
```

Core Web Vitals は特に LCP を hero screenshot の読み込みで悪化させないことを確認する。

数値を通すために画像品質や読みやすさを不自然に落とすことはしない。

### 10.6 Product truthfulness

最重要の acceptance。

- LP の screenshot が現行 product と一致する
- CTA の download / release link が実在する
- supported OS / Chrome / installation 手順が README と一致する
- Local-first / context retrieval の説明が実装を過大表現していない
- Map の例が実際の renderer で生成可能

---

## 11. Cloudflare Pages launch procedure

### Phase A — repository publication

1. local directory を `/Users/kiku28/pj/apps/Lensmap` へ変更
2. public-safe scan を実行
3. author metadata を GitHub noreply identity へ正規化
4. GitHub `kikutadev/Lensmap` を Public で作成
5. `origin` を設定し `main` を push
6. GitHub 上で README / license / visibility / rendered assets を確認

### Phase B — Direct Upload Pages project

1. `npm run lp:check`
2. `npm run lp:build`
3. `npx wrangler pages project create lensmap --production-branch=main` を冪等化した setup command で実行
4. `npx wrangler pages deploy apps/landing-page/dist --project-name=lensmap --branch=<preview>` で preview deploy
5. preview URL で visual / link / console / Lighthouse acceptance
6. production gate 通過後だけ `--branch=main` で production deploy
7. deployment list / returned URL から deploy success を機械確認

Git push は production deploy を自動発火させない。

### Phase C — custom domain

1. Pages Domains API から `lensmap.kikuta.dev` を project `lensmap` に関連付ける
2. Cloudflare DNS zone が同一accountなら必要なDNS状態を確認する
3. domain validation / certificate status をpollして `active` を確認する
4. `https://lensmap.kikuta.dev` で production smoke test

可能な限り setup script から実行する。Cloudflare credentialの権限不足でDNS変更だけ自動化できない場合は、その一点だけを明示して control-plane 操作とし、通常のLPリリースは引き続きCLIのみで行える状態を維持する。

### Phase D — canonicalize production URL

- canonical URL を `https://lensmap.kikuta.dev` に固定
- `<project>.pages.dev` を検索上のcanonicalにはしない
- preview deployments は preview URL として利用する

---

## 12. Implementation sequence

### P0 — Foundations

- [ ] `apps/landing-page` Astro workspace を作成
- [ ] static output / TypeScript strict baseline
- [ ] shared design tokens / global styles
- [ ] Japanese / English routing
- [ ] root workspace scripts との整合

### P1 — Product story

- [ ] Hero
- [ ] Focus → Expand → Map
- [ ] Map showcase
- [ ] Evidence / traceability
- [ ] Local-first / privacy
- [ ] Installation / GitHub Release CTA
- [ ] Footer

### P2 — Product media

- [ ] production build から screenshot states を生成
- [ ] hero composition
- [ ] Map sample 3種類
- [ ] responsive image optimization
- [ ] OG image

### P3 — Production quality

- [ ] responsive acceptance
- [ ] light / dark
- [ ] reduced motion
- [ ] accessibility
- [ ] SEO / sitemap / OG
- [ ] CSP / security headers
- [ ] Lighthouse / link / console validation

### P4 — Publish

- [x] GitHub `kikutadev/Lensmap` Public repository を作成し、`origin` / `main` をpush
- [ ] Cloudflare Pages Direct Upload project / CLI deploy scripts
- [ ] `*.pages.dev` preview / production acceptance
- [ ] `lensmap.kikuta.dev` custom domain
- [ ] HTTPS / DNS / canonical validation
- [ ] final production screenshot comparison
- [ ] launch commit

---

## 13. Definition of Done

次をすべて満たして計画完了とする。

- `apps/landing-page` が Astro static site として clean build できる
- Japanese / English LP の意味・品質が揃っている
- Lensmap Concept Doc の Focus → Expand → Map が LP の情報階層として伝わる
- actual product screenshot / actual Map が使われている
- mobile / desktop / light / dark / reduced motion が受入済み
- accessibility / SEO / OG / performance を production build で確認済み
- GitHub repository へ push 済み
- Cloudflare Pages の Wrangler Direct Upload production deployment が成功している
- `https://lensmap.kikuta.dev` が HTTPS で正常表示される
- production CTA が実在する GitHub Release / installation path へ接続される
- `*.pages.dev` と custom domain の canonical handling が決まっている
- README / Concept / Privacy / Security と LP の説明に矛盾がない
- 実装後に本 plan の未了項目がなくなり、必要な恒久仕様を SSOT へ反映したうえで plan file を削除できる

---

## 14. Decisions made in this plan

以下は implementation 前提として確定扱いにする。

1. LP は Lensmap 本体 monorepo の `apps/landing-page` に置く。
2. Astro の static generation を使い、初期 launch では SSR を使わない。
3. Cloudflare Pages は Wrangler CLI Direct Upload を production path とし、Git push 自動deployは使わない。
4. Production URL は `https://lensmap.kikuta.dev` とする。
5. 日本語 root + `/en/` の二言語対応とする。
6. 実製品 screenshot / actual Map を LP の一次 visual とし、LP上はCSS compositionを優先、OG等の固定画像だけ軽量なNode rendererで生成する。
7. analytics / cookie / external font CDN は初期 launch では導入しない。
8. GitHub Release を acquisition / install CTA の正とする。
9. Apple HIG に由来する hierarchy / restraint を使うが、Apple marketing page の模倣はしない。
10. LP の完成判定に本番 URL 上での visual / accessibility / performance acceptance を含める。
11. Spexのcapture→asset生成の分離は参考にするが、Lensmapの静止画用途にRemotionは導入しない。
