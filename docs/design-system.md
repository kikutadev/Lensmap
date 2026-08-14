# Lensmap Design System

Date: 2026-08-14
Status: Accepted / Normative

## 1. Design intent

Lensmap の UI は「AI PDF ツール」ではなく、**読書に付随する知的な macOS productivity surface** として設計する。

中心原則は `docs/concept.md` に従う。

> 気になった一節から、理解の地図をつくる。

> AI is the lens. The map is the outcome.

Apple Human Interface Guidelines を第一参照とする。ただし Lensmap は Chrome Side Panel であり AppKit / SwiftUI アプリではないため、system component の見た目を CSS で模造するのではなく、**HIG の hierarchy / layout / materials / typography / motion / accessibility の原則を Web UI へ翻訳する**。

Primary references:

- Apple HIG — Layout
- Apple HIG — Materials
- Apple HIG — Typography
- Apple HIG — Sidebars
- Apple HIG — Toolbars
- Apple HIG — Motion
- Apple HIG — Designing for macOS

### 1.1 Normative decisions

以下は実装上の推奨ではなく、Lensmap の確定仕様とする。変更する場合は本仕様を先に更新する。

1. Primary navigation は `Explore | Maps` の compact segmented navigation とし、Side Panel 内に追加 Sidebar を設けない。
2. typography は system font を基準とし、macOS では `-apple-system` / SF Pro 系を利用する。通常情報に 8–9px text を使わない。
3. material / blur / translucency は toolbar、navigation、composer、popover 等の control layer に限定する。content 全体を glass card 化しない。
4. Assistant response は outlined card に閉じ込めず、full-width の reading surface として表示する。
5. References / Evidence は provenance を保ちつつ、本文より低い visual weight にする。
6. 正常に完了した Explore response はすべて自動で Maps に保存する。手動保存・手動昇格を通常フローに置かない。
7. Maps library は visual-first とし、text-only artifact list を完成形としない。
8. light / dark appearance、keyboard focus、`prefers-reduced-motion` を production acceptance の必須条件とする。
9. AI を示す目的の gradient / neon glow / decorative animation をブランド表現の中心にしない。
10. Apple 製アプリの pixel copy を目指さず、HIG の原則を Lensmap 固有の UI に翻訳する。

## 2. Product hierarchy

視覚階層は次を守る。

```text
Reading context
  > Current Explore question / answer
    > Map visual understanding
      > Evidence / references
        > Codex / retrieval / technical status
```

Codex、token usage、retrieval audit、artifact kind は機能上必要でも、通常の読書画面では主役にしない。

## 3. Shell

### 3.1 Toolbar

上端は 1 つの compact toolbar とする。

```text
Lensmap                         [context/model] [?]
```

- ブランドアイコンを濃い四角形カードに入れない
- `Chrome PDF + grounded Codex` のような implementation subtitle を常時表示しない
- title と trailing actions を明確に分離する
- error がない限り connection state を常時主張しない
- toolbar は content から分離した control layer とする

Chrome では true Liquid Glass を再現しない。`backdrop-filter` と低コントラストの translucent surface は navigation / composer 等の control layer にのみ限定する。

### 3.2 Primary navigation

Chrome Side Panel は幅が限られるため、追加 Sidebar を作らない。

```text
[ Explore | Maps ]
```

compact segmented navigation とし、黒ベタの active tab は使わない。

### 3.3 Main content

- content は panel 幅を有効活用する
- outer margin は 12–16px を基準とする
- card で囲う前に whitespace / alignment / separator で hierarchy を作る
- 同種のカードを縦に大量に積まない

## 4. Typography

Font stack:

```css
font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif;
```

Web 配布物へ SF Pro font file を同梱しない。macOS では system font を利用し、他 OS では fallback する。

基準:

| Role | Size | Weight | Usage |
|---|---:|---:|---|
| View title | 17px | 600 | Map title / empty-state title |
| Section title | 13px | 600 | References / thread / evidence |
| Body | 13px | 400 | Answer / explanation |
| Control | 12–13px | 500 | Buttons / segmented control |
| Secondary | 11–12px | 400 | metadata / page / hint |
| Micro | 10px | 500 | exceptional compact metadata only |

8px / 9px を通常 UI の情報伝達に使用しない。

本文は `line-height: 1.5–1.6` を基準にし、Map detail / long-form answer は reading rhythm を優先する。

## 5. Color and appearance

semantic token を使い、Slate 系の固定色を component ごとに直書きしない。

```text
--surface
--surface-raised
--control-surface
--label-primary
--label-secondary
--label-tertiary
--separator
--accent
--danger
--warning
--success
```

### Light / Dark

- `color-scheme: light dark`
- `prefers-color-scheme` に追従
- content surface と controls/navigation surface の depth を変える
- accent color は action / selection / citation 等の意味がある箇所だけに使う
- AI を示すための gradient / neon glow を使わない

## 6. Materials and depth

### Control layer

対象:

- top toolbar
- segmented navigation
- floating/sticky composer
- popover

ここでは restrained blur / translucency / shadow を使ってよい。

### Content layer

対象:

- answer
- Map detail
- references
- tables / diagrams / charts

原則として opaque / standard surface とし、glass card 化しない。

**Everything is a card** を禁止する。

Border を使う場合も、component 全周を囲うより separator を優先する。

## 7. Explore

### 7.1 Thread control

native-like menu row とする。

```text
Architecture questions ▾                               +
```

常時 border box の select + button を並べる見た目を避ける。

### 7.2 Reference shelf

Reference は input context なので composer 付近に compact に置く。

Collapsed:

```text
References · 3                                      ›
```

Expanded:

```text
Book A · p.42
“Replication means ...”

Book B · p.18                    AI added
“Consensus requires ...”
```

- `S1` は citation resolution 用には残すが、単独で主語にしない
- reference ごとに白い card を作らない
- Book / page / quote を hierarchy で見せる

### 7.3 Messages

User:
- subtle filled bubble
- trailing alignment
- prompt であることだけ分かればよい

Assistant:
- card に入れない
- reading document として full width に表示
- `Codex` label を毎回答の主見出しにしない
- headings / paragraphs / diagrams に自然な vertical rhythm を与える

Retrieval:
- `3箇所を追加参照` の disclosure row
- raw JSON / tool name は advanced/debug のみ

Auto-save:

```text
✓ Maps に保存済み                                  Mapsで開く
```

quiet status とし、保存ボタンにしない。

### 7.4 Composer

Composer は content card ではなく、現在の Explore を操作する control surface とする。

- bottom sticky
- rounded 14–16px
- subtle material / separator
- text area は borderless
- send は symbol-dominant circular/compact action
- keyboard shortcut は常時大きく表示しない
- focus ring を明確にする

## 8. Maps

### 8.1 Library

Maps は text-only Insight list にしない。

Side Panel では 1-column visual collection を基本とする。

```text
[ visual preview ]
CDNとEdgeの責務
短い説明
DDIA p.42 · Cloudflare p.18
```

- visual preview が主役
- `diagram`, `markdown`, `v3` 等の internal metadata を一覧の主情報にしない
- card border は必要最小限。preview surface と spacing で区切る

### 8.2 Map detail

Navigation stack として扱う。

```text
‹ Maps                                     Edit

CDNとEdgeの責務

[ primary visual ]

Explanation

Evidence · 3                               ›
```

優先順位:

1. title
2. visual understanding
3. explanation
4. evidence
5. history / diff / advanced metadata

Version / diff は secondary action へ置く。

Editor で raw JSON を通常ユーザーへ見せない。構造化 block の編集は form / regenerate / visual form selection へ置き換える。

## 9. Status and errors

Recoverable state は inline status row を基本とする。

```text
! Lensmap に接続できません                       再接続
```

- 黄色/赤の大きな card を通常状態の一部にしない
- action を 1 つ明確にする
- technical detail は disclosure / Helpへ
- importing → resolving のような短い内部状態は頻繁に文字を切り替えず、`PDFを準備中…` の stable state にまとめる

Ambiguous selection のように判断が必要な状態だけ、content area を使って候補を提示する。

## 10. Motion

motion は status / spatial continuity / feedback のためだけに使う。

- view transition: 140–200ms opacity + small translation
- disclosure: 120–180ms
- popover: 120–160ms opacity + scale/translation
- streaming content に layout-jank を起こす animation を入れない
- infinite spinner は実際に待機が必要な状態だけ
- `prefers-reduced-motion: reduce` では nonessential transition を無効化

## 11. Interaction and accessibility

- keyboard first を維持
- `Cmd/Ctrl + Enter` send
- visible `:focus-visible`
- icon-only action は `aria-label` / tooltip を持つ
- hover だけに重要情報を依存させない
- citation popover は focus でも開く
- text contrast を decorative subtlety より優先する
- controls の click target は desktop Side Panel でも窮屈にしない

## 12. Prototype-smell checklist

以下が増えたらデザインを見直す。

- 1画面に 5 個以上の outlined card
- 8–9px text が通常情報に使われている
- badge / pill が意味なく増える
- active state が黒ベタ
- technical terms が user goal より上位に見える
- every section に heading + count badge + border card がある
- icon が colored tile の中に毎回入る
- gradient / glow で「AIらしさ」を表現する
- shadow が content card の装飾として乱用される
- raw JSON / renderer kind / grounding status が通常 UI に見える

## 13. Acceptance

Lensmap の UI が production quality とみなせる条件:

1. 320–480px 幅で hierarchy が崩れない。
2. body text が 13px 前後で読みやすい。
3. Explore assistant response が card ではなく reading surface に見える。
4. Maps が visual-first collection に見える。
5. controls/navigation と content の depth が区別される。
6. light / dark の両方で成立する。
7. keyboard / focus navigation が成立する。
8. reduced motion が成立する。
9. technical status を閉じても主要体験が理解できる。
10. Apple 製アプリのコピーではなく、HIG に沿った Lensmap 固有の情報設計になっている。
