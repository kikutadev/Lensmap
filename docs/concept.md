# Lensmap Concept Doc

Status: Accepted / Normative

## 1. Purpose

Lensmap は、技術書や PDF を AI に丸ごと読ませるためのチャットツールではない。

**読んでいる一節を起点に、必要な文脈だけを掘り、根拠付きの理解を図解として残す**ための読書ツールである。

プロダクトを一言で表す。

> **気になった一節から、理解の地図をつくる。**

英語では次を基準コピーとする。

> **Turn passages into maps of understanding.**

より機能的に説明する場合は次を使う。

> Lensmap helps you explore the context behind a passage and turn what you learn into visual, traceable insights.

この文書は Lensmap の機能採否、UI、用語、情報設計を判断するための上位原則である。詳細な挙動は `product-spec.md`、技術構成は `architecture.md`、個別 UI は `ui-and-visualization.md` を参照する。仕様と本 Concept Doc が思想レベルで衝突する場合は、仕様側を見直す。

---

## 2. Name as product model

`Lensmap` は単なるブランド名ではなく、製品モデルを表す。

### Lens

AI は「本を代わりに読む主体」ではない。

**ユーザーが注目した一節・図表へ焦点を当て、必要に応じて周辺・節・関連箇所まで視野を広げるための Lens** である。

Lens の役割は次に限定する。

- 選択した一節・図表を理解する
- 不足する文脈を必要な分だけ追加取得する
- 比較、因果、構造、前提、設計意図を整理する
- どの原文に基づく理解かを失わない

### Map

チャット回答は最終成果物ではない。

**Map は、得られた理解を後から一目で再構築できる、視覚的かつ根拠付きの知識成果物**である。

Map は単なる Mermaid 図を意味しない。内容に適した表現を組み合わせる。

- 概念関係図
- 因果関係
- 処理フロー
- システム構成
- 比較表
- 階層
- タイムライン
- Matrix
- Chart
- 短い説明文と図解の組み合わせ

無理に図へ変換することはしない。文章だけの方が明確な部分は文章を使う。ただし、**保存成果物は会話ログではなく、理解の構造が見える形へ再編集されていること**を求める。

---

## 3. Core loop

Lensmap の基本ループは次である。

```text
Read
  ↓
Focus
  ↓
Explore
  ↓
Map
  ↓
Return to reading
```

製品内の短い概念モデルとしては次を使う。

```text
Focus → Expand → Map
```

### Focus

ユーザー自身が「ここが気になる」「ここが分からない」を決める。

Focus は `Text Passage` と `Visual Region` の双方を含む。画像を選択した場合は画像そのものを一次情報とし、OCRは派生情報として扱う。

- 読書が先、AI が後
- PDF 全体の自動要約から始めない
- 選択した passage / visual region が問いの原点になる

### Expand

選択箇所だけで足りない場合に限り、AI が文脈を広げる。

```text
Selected passage / visual region
  ↓
Nearby blocks
  ↓
Same section
  ↓
Book / Workspace search
  ↓
Necessary passages only
```

重要なのは「最小トークン」そのものではなく、**何を追加で読んだかが限定され、追跡できること**である。

### Map

探索で得た理解のうち、残す価値のあるものを Map へ変換する。

Map は少なくとも次を持つ。

```text
Visual understanding
        +
Concise explanation
        +
Evidence / passages
        +
Backlinks to PDF
```

---

## 4. Product principles

### P1. Reading stays primary

本文が主役であり、AI UI が読書を乗っ取らない。

Chrome 標準 PDF Viewer を表示 Surface として利用することは、この原則と一致する。独自 Reader を作ること自体を価値にしない。

### P2. Start from human attention

Lensmap は「PDF をアップロードして AI に何かしてもらう」ことから始めない。

ユーザーの選択、疑問、比較したい箇所など、**人間の注意**を起点にする。

### P3. Expand context deliberately

全文を最初からモデルへ投入しない。一方で、選択範囲だけに過度に閉じこもることもしない。

質問へ答えるために意味のある場合は、AI が積極的に前後・節・関連箇所を探索してよい。ただし、その探索範囲と実際に読んだ本文を audit 可能にする。

### P4. Every durable insight is traceable

後から見返したとき、

> なぜこう理解したのか

を辿れなければ Map として不十分である。

Map から原文へ戻れることを保証する。可能であれば原文側から関連 Map へ辿れる関係も持つ。

### P5. Conversation is process; Map is the automatically retained outcome

Explore / Thread は探索と思考のための Surface である。一方、**正常に完了した Assistant 回答は自動的に Map として保存する**。ユーザーへ保存操作を要求しない。

```text
Explore response completes
        ↓
Map is persisted automatically
        ↓
Maps libraryからいつでも再利用できる
```

会話ログ全体と Map は同一物ではない。Map は各完了回答を、その回答が持つ説明・図解・表・根拠・PDF backlink とともに再利用可能な成果物として保持する。図解が有効な内容では回答生成時から visual structure を積極的に含める。

### P6. Visual-first, not diagram-forced

図解できるものは積極的に図解する。

ただし「図を出すこと」自体を目的化しない。理解に最も適した表現を選ぶ。

### P7. Local-first by default

PDF、索引、会話、Map、provenance はローカル保存を基本とする。

AI へ送るのは質問、明示的に選択した本文、回答に必要な追加本文、bounded conversation context に限定する。

---

## 5. Naming invariant / Domain language

Lensmap は初回リリース前であり、旧ブランドとの互換性を持つ必要はない。したがって **旧ブランド名・旧runtime識別子・互換aliasを製品内に残さない**。

次はすべて Lensmap を正とする。

- product / extension / server display name
- npm package scope
- TypeScript のブランド接頭辞
- environment variable prefix
- Chrome storage key prefix
- Native Messaging host / wrapper
- macOS Application Support directory
- SQLite file name
- release archive / artwork name
- scripts / test fixtures / service identifier
- README / Privacy / Security / docs

`SourceAnchor`、`ExploreThread`、`MapArtifact` は正規domain semanticsとして使用する。旧domainとの互換aliasは残さない。

ユーザー向け UI は内部 domain 名をそのまま露出させず、目的中心の語彙を使う。概念を次のように整理する。

| Layer | Meaning | User-facing role |
|---|---|---|
| Focus / SourceAnchor | 読書中に注目した一節・図表と位置情報 | 参照・根拠 |
| Explore / ExploreThread | 問いを掘り下げる対話・探索 | Lens |
| Insight | 得られた理解そのもの | Map の内容 |
| Map / MapArtifact | Insight を視覚的・根拠付きに再構成した保存成果物 | durable outcome |
| Workspace | 複数 PDF、Explore、Maps を束ねる読書テーマ | reading context |

原則として user-facing navigation に `Chat` や内部 Artifact kind を主語として置かず、ユーザーの目的に合わせて `Explore` / `Maps` を使う。

`SourceAnchor` は API / schema 名として有用だが、UI では `参照`、`選択箇所`、`AI追加参照` 等の自然な言葉を優先する。

---

## 6. What makes a Map

Map は手動で「昇格」させるものではない。Explore の正常完了時に自動保存される。以下は、その自動保存される成果物をどのような品質で生成・表示するかの基準である。

Map と呼べるための最低条件を定める。

1. **One idea** — 何を理解するための成果物かタイトルから分かる。
2. **Structured** — チャットログではなく、関係・比較・順序・要点が整理されている。
3. **Visual where useful** — 図解に意味がある場合、diagram / table / chart 等を含む。
4. **Grounded** — 根拠となる passage を保持する。
5. **Traceable** — passage から元 PDF へ戻れる。
6. **Reusable** — Thread を読み直さなくても Map 単体で意味が分かる。
7. **Versioned** — 編集時に由来と変更履歴を失わない。

正常に完了した Assistant response は自動的に Map として保存する。保存は `originTurnId` 等で冪等化し、retry / reload で重複 Map を作らない。Map 保存に失敗しても、正常に生成できた Explore 回答そのものを失敗扱いにしない。

---

## 7. Workspace and multi-document reading

Lensmap の中心は Chrome Tab ではなく、読書テーマを保持する Workspace である。

```text
Workspace
 ├─ Documents
 ├─ References
 ├─ Explore Threads
 └─ Maps
```

Chrome Tab は次のための Surface に留める。

- PDF を読む
- passage を選択する
- citation から原文へ戻る

複数 PDF を比較して得た理解も 1 つの Map にできる。Map は primary document に固定せず、複数 document の provenance を持てることを前提とする。

詳細な挙動は `product-spec.md`、`architecture.md`、`ui-and-visualization.md`、`maps-and-context-retrieval.md` を正とする。

---

## 8. Anti-goals

Lensmap は以下を中心価値にしない。

### Full-document AI autopilot

PDF 全文を渡して、自動で要約・問題作成・ノート大量生成することを主 UX にしない。

### Generic chatbot

何でも質問できる ChatGPT の代替を目指さない。読書中の本文と Workspace 文脈を起点にする。

### Note-taking app

自由なメモ帳、Notion、Obsidian の代替を目指さない。Map は読書から得た理解を残す成果物である。

### Citation manager

文献管理や bibliography 管理を主目的にしない。provenance は理解を原文へ戻すためにある。

### Diagram generator

綺麗な図を生成するだけのツールにしない。図は grounded understanding を残す手段である。

---

## 9. Feature decision test

新機能を検討するときは、最低限次を問う。

1. 読書を中断させるのではなく、読書を助けるか。
2. ユーザーが注目した passage / question と関係しているか。
3. 必要な context を適切に広げられるか。
4. AI が何を根拠にしたか追跡できるか。
5. 良い理解を Map として残しやすくなるか。
6. Map から原文へ戻れるか。
7. Chat の機能を増やすだけになっていないか。

このうち 5〜6 を満たさない機能は、Lensmap の差別化へ寄与しているか慎重に判断する。

---

## 10. Canonical phrases

### Japanese

**Tagline**

> 気になった一節から、理解の地図をつくる。

**One sentence**

> Lensmap は、PDF を読みながら選んだ箇所を起点に文脈を掘り、根拠付きの理解を図解として残すローカル読書ツールです。

### English

**Tagline**

> Turn passages into maps of understanding.

**Product principle**

> AI is the lens. The map is the outcome.
