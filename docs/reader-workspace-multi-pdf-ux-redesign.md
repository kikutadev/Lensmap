# Reader Workspace / Multi-PDF / Codex UX 再設計方針

## 1. 背景

現状のLensmapは、Chromeのアクティブタブを中心にPDF、References、Chat、Composer、Maps表示状態を持つ設計になっている。

この構造は単一PDFを1タブで読むMVPには単純だが、実際の読書行動には合わない。

主な問題は次の通り。

1. ExploreがChromeタブのライフサイクルに過度に依存する。
2. 複数PDFを横断して比較・統合するExploreができない。
3. 同じPDFを別タブで開くと、Exploreとの対応関係が不自然になる。
4. PDFタブを閉じることと、読書セッションを終了することが同義になってしまう。
5. References / Explore / MapsというLensmap固有の知識状態が、ブラウザの表示状態に引きずられる。

したがって、製品の中心概念を **Tab** から **Reader Workspace** へ変更する。

---

## 2. 中心概念

LensmapのWorkspace配下の主要オブジェクトは次の4つとする。

```text
Reader Workspace
 ├─ Documents
 │   ├─ Book A (PDF)
 │   ├─ Book B (PDF)
 │   └─ Book C (PDF)
 │
 ├─ References
 │   ├─ A:S1
 │   ├─ A:S2
 │   └─ B:S3
 │
 ├─ Explore Threads
 │   ├─ Thread 1
 │   └─ Thread 2
 │
 └─ Maps (MapArtifact)
```

Chrome TabはWorkspaceの所有者ではない。

Chrome Tabはあくまで、

- PDFを表示する
- 選択範囲を取得する
- 引用元へ戻る

ための **Document View / Capture Surface** と位置付ける。

---

## 3. WorkspaceとChrome Tabの関係

1つのWorkspaceに複数PDFを追加できる。

```text
Workspace: 「CDN / Edgeを理解する」

Documents
- Designing Data-Intensive Applications.pdf
- Cloudflare Architecture.pdf
- Web Performance Handbook.pdf
```

同じPDFが複数タブで開かれていても、Lensmap上では同じBookとして扱う。

PDFタブを閉じても、Workspace / Explore / References / Mapsは残る。

アクティブタブは次の用途に限定する。

- 「現在見ているPDF」の表示
- 選択箇所のCapture
- 引用クリック時の移動先候補

Exploreの表示内容をアクティブタブで切り替えない。

PDFを選択して右クリックしたとき、Referenceは現在選択中のWorkspaceへ追加する。Workspace未選択の場合は、最初のCapture時にWorkspaceを自動作成する。

別PDFを別タブで開いて選択した場合も、同じWorkspaceへ追加できる。

---

## 4. Explore

Explore Threadは `bookId` ではなく `workspaceId` に属する。

現状:

```text
Book -> Explore Thread
```

変更後:

```text
Workspace -> Explore Thread
           -> N Books
           -> N References
```

Turnごとに、複数BookのSourceAnchorを添付可能とする。

```text
Question
「この2つの説明の違いは？」

References
S1 · Book A · p.12
S2 · Book B · p.42
```

Reference labelはTurn内で一意とし、内部的には `sourceAnchorId / bookId / page / label / origin` を保持する。

Codex modelはThread単位のdefaultとする。UIで変更した場合は現在Threadの次Turnから適用し、Explore履歴は維持する。モデル変更だけでThreadを作り直さない。

---

## 5. Codex利用状況UI

Codex表示はSide Panel右上に置く。

```text
[ ◔ 31 ] GPT-5.6 Sol
```

クリックするとpopoverを表示する。

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

Context gaugeはCodex App Serverの `thread/tokenUsage/updated` を使用し、`last.totalTokens / modelContextWindow` を表示する。推定値ではなくCodexから取得した値を利用する。

全体利用率は `account/rateLimits/read` の `usedPercent` を表示する。「あと何回使えるか」のような疑似残回数には変換しない。

---

## 6. 引用UX

現状の `[S1]` や `S1 · PDF p.3` だけでは何の根拠か分からない。これは技術的限界ではなくUI不足である。

Inline citationは `[S1]` を維持するが、hover / focusで以下を表示する。

```text
S1
Designing Data-Intensive Applications
PDF p.42

“Replication means keeping a copy of the same data...”

選択箇所
```

回答下部の引用も、

```text
S1 · Book A · p.42 · “Replication means keeping...”
S2 · Book B · p.18 · “Consensus requires...”  [AI追加]
```

のように本文previewまで表示する。

引用クリック時は、

1. 既に同じPDFを開いているChrome tabがあればそのtabをactivate
2. なければ新しいPDF tabを開く
3. `#page=N` で対象ページへ移動

とする。

Chrome標準PDF Viewerを維持する限り、本文矩形への精密なハイライトは保証しない。したがってLensmap UI側でquote previewを必ず見せ、`S1`単体で意味を持たせない。

---

## 7. Maps / MapArtifact

正常に完了したAssistant responseはユーザー操作なしで`MapArtifact`として自動保存する。

MapArtifactはMarkdown blockの保管庫ではなく、Exploreで得た理解を単体で再利用できるdurable outcomeとする。

最低条件:

- One idea
- Structured
- Visual where useful
- Grounded
- Traceable
- Reusable
- Versioned

MapArtifact自体を`note / report / table / diagram / chart`のkindで分類しない。Narrative / Table / Diagram / Chart等のMapBlockを組み合わせる。

保存は`originTurnId`で冪等化し、Map保存失敗で正常なExplore回答を失敗扱いにしない。

Maps listはvisual-firstとし、thumbnail / title / preview / referenced Books/pages / updated timeを表示する。Map detailはvisual understanding → concise explanation → Evidence → historyの順にする。

`needs-review`等の内部Grounding stateは通常UIへそのまま露出しない。

---

## 8. AIによるPDF自律探索

既に次のBook toolは存在する。

```text
book_expand_source
book_search
book_read_blocks
book_list_sections
book_read_section
```

問題はtool不足ではなく、Instructionが保守的すぎる点にある。現状は「Sourceが不足している場合だけ必要最小限読む」という方向であり、モデルが「選択範囲だけで回答可能」と判断すると探索しない。

以下の質問では、追加探索を積極的に行う。

- なぜそうなるか
- 比較
- 因果関係
- 設計意図
- 定義
- 章全体との関係
- 複数概念の統合
- 「この本ではどう説明しているか」

基本探索順:

```text
Explicit References
    ↓
Nearby blocks
    ↓
Same section
    ↓
Book search
    ↓
Read matched blocks
```

複数PDF Workspaceでは検索対象も複数Bookへ広げる。

BookToolSessionはWorkspace awareに拡張し、概念的には次のAPIへ移行する。

```text
workspace_search
  query
  bookIds?: []

workspace_read_blocks
  [{ bookId, blockId }]

workspace_list_sections
  bookId

workspace_read_section
  bookId
  sectionId
```

モデルがどのPDFを検索したかは必ずauditへ残す。

通常UIでは生JSONの「AI参照履歴」を見せず、例えば次のように人間向けに要約する。

```text
この回答では3箇所を追加参照しました
- Book A p.43 前後文脈
- Book B p.18 検索: consensus
- Book B p.21 同一節
```

詳細auditはDebug/advanced UIへ分離する。

---

## 9. Help / Onboarding

公開版には常時到達可能なHelp導線を置く。

Side Panel右上:

```text
[ ? ]
```

Helpには最低限以下を記載する。

1. 最初の使い方
2. PDFからSourceを追加する方法
3. 複数PDFをWorkspaceへ追加する方法
4. S1/S2引用の意味
5. AI追加参照の意味
6. Mapsは自動保存されること
7. Codex Context / 利用率表示の意味
8. モデル変更
9. ローカルPDF権限
10. 現状の制約

初回利用時のみ簡単なonboardingを表示する。ただし毎回モーダルを出さず、Helpへ常時戻れることを優先する。

---

## 10. Side Panel情報設計

Header:

```text
Lensmap                   [Context gauge] [Model] [?]
```

Workspace selector:

```text
Workspace
[ CDN / Edgeを理解する        v ] [+]
```

Main navigation:

```text
Explore | Maps
```

Explore:

```text
Thread selector

Documents 2
References 3

Explore messages

Composer
```

Documents / Referencesは常時巨大表示せず、compact summaryから展開可能にする。

---

## 11. 永続化モデル

Canonical schema:

```text
reader_workspaces
workspace_books
explore_threads
explore_turns
turn_sources
map_artifacts
map_versions
map_blocks
map_sources
map_block_sources
map_origin_turns
```

Explore Threadは`workspace_id`を所有キーとする。Turn ReferenceはSourceAnchor自体がBookを内包するためmulti-book対応できる。

MapのBook集合は`map_sources -> source_anchors -> books`から導出し、単一`primaryBookId`をauthorityにしない。

---

## 12. 開発DB移行方針

初回リリース前のため、製品互換用のlegacy domain migration layerは作らない。

開発中の既存データを保持して検証する必要がある場合だけ、一回限りのdevelopment migrationまたはfixture変換を用意する。正式schema・runtimeにlegacy aliasやfallbackを残さない。

Workspace導入後の正規構造は `Workspace -> ExploreThread -> Turn` と `Workspace -> MapArtifact` とする。

---

## 13. 実装順

### Phase 1: Domain切替

1. ReaderWorkspace schema / repository / service追加
2. WorkspaceとBookのmany-to-many
3. canonical `explore_threads` / `explore_turns` を追加
4. `map_artifacts` / `map_versions` / `map_blocks` を追加
5. 既存development dataの必要最小限変換

### Phase 2: Side Panel

1. Workspace selector
2. Workspace内Documents
3. Capture時にactive WorkspaceへSource追加
4. アクティブTabによるExplore自動切替を廃止
5. 引用クリック時のPDF tab resolution

### Phase 3: Codex

1. model/list UI
2. account/rateLimits/read
3. thread/tokenUsage/updated
4. Context gauge
5. Thread model変更

### Phase 4: Retrieval

1. BookToolSessionをWorkspaceToolSessionへ拡張
2. 複数Book search/read
3. Instructionをproactive explorationへ変更
4. audit UIを人間向けに変更

### Phase 5: MapArtifact / Maps

1. 回答完了時のMapArtifact自動保存
2. originTurnId冪等化
3. Map-ready response / MapVersion materialization
4. block debugger風UIの廃止
5. visual thumbnail / preview / Book / pageを一覧表示
6. `要確認`文言廃止

### Phase 6: Public UX

1. Help page
2. `?` entrypoint
3. 初回onboarding
4. README / user guide更新
5. E2E

---

## 14. 完了条件

以下をすべて満たすこと。

1. PDF AとPDF Bを別Chrome tabで開き、同じWorkspaceへSourceを追加できる。
2. PDF tabを切り替えてもExploreが勝手に別threadへ切り替わらない。
3. PDF tabを閉じてもWorkspace / Explore / Mapsが残る。
4. 1 Turnで複数PDFのSourceを引用できる。
5. AIが複数PDFを自律探索できる。
6. S1を見るだけで引用本文のpreviewが分かる。
7. 引用クリックで対応するPDFへ戻れる。
8. 完了回答が自動的にMapArtifactとしてMapsへ保存される。
9. Mapsが回答ログの保管庫ではなくvisual / explanation / Evidenceを持つ成果物として表示される。
10. `要確認`という意味不明なUIラベルがない。
11. Codex modelをUIから選択できる。
12. Context利用率とCodex利用率を実データで表示できる。
13. `?`からHelpへいつでも到達できる。
14. 主要フローがHeadless E2Eで再現できる。

---

## 15. 結論

Lensmapは、

```text
Chrome Tab中心のPDF Chat拡張
```

ではなく、

```text
複数のPDFを集めて、根拠を辿りながら考えるReader Workspace
```

として設計する。

Chrome PDF Viewerは優れた表示Surfaceとして利用し続けるが、Explore / References / Maps / Codex stateの所有者にはしない。
