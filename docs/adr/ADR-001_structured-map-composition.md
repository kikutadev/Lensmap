# ADR-001: Mapの意味構造と表示形式を分離し、Codex Skill + Structured Map Draftを採用する

Date: 2026-08-15
Status: Accepted

## Context

Lensmapでは、正常完了したExplore回答を自動的に`MapArtifact`として保存する。

従来の主要経路は、AssistantのMarkdown回答を`parseMarkdownMapBlocks()`で分解し、その結果をMapとして保存する方式だった。この方式には次の問題がある。

- 比較・定義・因果・処理順など、回答時点では明確な意味構造があっても、保存時には単なるMarkdownへ潰れる場合がある。
- Mapの品質が、モデルが偶然table / Mermaid / `lensmap-viz`を出したかどうかに依存する。
- `table`や`chart`などの表示形式をMapの意味そのものとして扱うと、「定義を文章で示す」「比較を単純な表で示す」といった自然な表現を扱いにくい。
- Mermaidと`lensmap-viz` JSONの使い分けがモデル任せであり、構造化JSONをReact renderer・preview・編集へ再利用しにくい。
- Mapを後から編集・preview・versioningする際、Markdownの再解釈が必要になる。

一方、Lensmapには既に`@lensmap/visualization`があり、`comparison / flow / hierarchy / timeline / matrix / callout / chart`をZod allow-list schemaで検証し、React componentへ安全に描画できる。

また、利用しているCodex App ServerにはSkill discovery (`skills/extraRoots/set`, `skills/list`) とclient-provided dynamic toolsがあるため、Lensmap固有のMap compositionルールとstructured output contractをCodexへ渡せる。

## Decision

### 1. Mapの「意味」と「表示形式」を分離する

Mapが何を理解した成果物かを`MapSemanticKind`として扱う。

初期値は次とする。

```ts
type MapSemanticKind =
  | "definition"
  | "comparison"
  | "causal"
  | "process"
  | "hierarchy"
  | "timeline"
  | "quantitative"
  | "synthesis";
```

`table / chart / diagram / narrative`等はMapの種類ではなくpresentation/block形式である。

例:

```text
definition   → definition card / concise text
comparison   → table / comparison
causal       → flow
process      → flow / ordered steps
hierarchy    → hierarchy / structured outline
timeline     → timeline
quantitative → table / chart
synthesis    → mixed structured blocks
```

したがって、単純なtableだけで十分な比較Mapも正式なMapであり、文章中心のdefinition Mapも正式なMapである。

### 2. 構造化できる理解は生成時点で構造化する

「visualが必要か」ではなく「意味構造を抽出できるか」を判断基準とする。

表示が文章中心でも、内部まで非構造化Markdownへ戻さない。

例としてdefinitionは、少なくとも次のような構造を持てる。

```json
{
  "type": "definition",
  "term": "Write amplification",
  "definition": "論理的な書き込み量より実際の物理書き込み量が増える現象",
  "keyPoints": ["LSM compactionで発生する"],
  "sourceRefs": ["S1", "S2"]
}
```

### 3. `@lensmap/visualization`のJSON DSLを第一級のstructured presentationとする

既存のZod allow-list JSON DSLをReact-renderableな主要表現として利用する。

既存の

- comparison
- flow
- hierarchy
- timeline
- matrix
- callout
- chart

に加え、必要な実装として`definition`と`table`を第一級schemaへ追加する。

任意JSX / JavaScript / HTMLは引き続き実行しない。

### 4. Mermaidは削除せず、escape hatchとして残す

Mermaidを主要なMap構造表現にはしない。

優先順位は概ね次とする。

```text
structured JSON / structured block
        ↓
simple table / definition / narrative
        ↓
Mermaid（structured schemaで自然に表せない図のみ）
```

Mermaid sourceをユーザーへ通常編集UIとして露出しない。

### 5. CodexへLensmap専用Map Composition Skillを渡す

Lensmap server内にbuilt-in Skillを持つ。

```text
apps/server/skills/
  lensmap-map-composer/
    SKILL.md
    references/
      examples.md
      map-structures.md
```

Skillは主として「どう判断するか」を担当する。

例:

- 「Xとは？」→ `definition`
- 「AとBの違い」→ `comparison`; 少数項目ならtableを優先
- 「なぜAからCになる？」→ `causal`; relationが重要ならflow
- 「3製品×3指標」→ tableを優先し、不要なchartを作らない
- 「20時点の推移」→ `quantitative`; line chartを検討
- 図解より短い説明の方が明確なら、visualを強制しない

Map compositionのdecision tableとexamplesはSkillをSSOTとし、巨大な同内容promptを`ContextBuilder`へ重複させない。

Server起動時にApp ServerへSkill rootを登録し、`skills/list`でdiscoveryを確認する。

### 6. Structured Map Draftは`lensmap_compose_map` dynamic toolで提出する

CodexにMarkdown fenced JSONを書かせることを主要契約にはしない。

client-provided dynamic toolとして`lensmap_compose_map`を提供し、Map Draftをtool argumentsとして受け取る。

概念形:

```ts
interface MapDraft {
  semanticKind: MapSemanticKind;
  title: string;
  conciseExplanation: string;
  primaryBlock: StructuredMapBlock | null;
  supportingBlocks: StructuredMapBlock[];
}
```

実際のtool schemaはZod / JSON Schemaでallow-listし、`sourceRefs`は実在する`S#`だけを許可・検証する。

このtoolはDBへ直接書き込まない。per-turn memoryへ検証済みDraftを保持するだけとする。

```text
Codex turn
  ├─ workspace_* read-only retrieval
  ├─ user-facing answer
  └─ lensmap_compose_map(MapDraft)
             ↓
       validated per-turn Draft
             ↓
       assistant turn completed
             ↓
          MapService
             ↓
       MapArtifact / MapVersion
```

これにより、Codex tool callの成否とDB persistenceを分離し、既存のMap自動保存・冪等化責務を`MapService`へ残す。

### 7. Markdown parserはfallbackとして維持する

`lensmap_compose_map` Draftが得られなかった場合でも、正常なExplore回答を失敗扱いにしない。

その場合のみ既存のMarkdown parserでMapをmaterializeする。

したがって主要経路はstructured Draftだが、Exploreの可用性をMap構造化機能へ依存させない。

### 8. `semanticKind`と`primaryBlockId`はMapVersionに属する

Map編集によって意味構造やprimary blockが変わり得るため、永続化上は`MapArtifact`固定属性にしない。

```text
MapArtifact
  └─ MapVersion
       ├─ semanticKind
       ├─ primaryBlockId
       └─ MapBlocks
```

通常APIのMap detail / summaryではlatest versionの`semanticKind` / `primaryBlockId`を投影してよい。

## Alternatives considered

### A. 現在どおりMarkdown parsingだけを使う

却下。

実装は単純だが、意味構造が回答文面に依存し、Mapのpreview・編集・再利用で再解析が必要になる。

### B. Explore回答後に2回目のLLM callでMapを再生成する

初期案としては却下。

構造化品質は上げやすいが、全Turnでlatency・token消費・失敗点を増やす。まず同一Turn内でSkill + tool callにより回答とMap Draftを生成する。

将来、同一Turn方式で品質不足が実測された場合のみ再検討する。

### C. すべてをMermaidへ変換する

却下。

定義・小規模比較・少数数値まで図化すると過剰表現になる。また、構造編集・preview・React UIとの統合性が低い。

### D. MapArtifact自体を`definition / table / chart / flow`等の単一kindにする

却下。

`definition`は意味分類だが`table`は表示形式であり抽象度が異なる。また1つのMapが複数blockを持てなくなる。

### E. 自由Canvas / knowledge graphを主要Map UIにする

却下。

今回解決したい問題は、Mapの意味構造と再理解性であり、ユーザーによる空間配置ではない。読書Side Panelの複雑性も不必要に上げる。

## Consequences

### Positive

- definitionのような文章中心Mapも内部では構造化できる。
- comparisonをtableだけで表すなど、最小で自然な表現を選べる。
- Map一覧previewをstructured dataから安定して生成できる。
- Map detailのprimary contentを明示できる。
- React rendererとMap persistenceが同じschemaを共有できる。
- raw JSON / Mermaidをユーザーへ編集させずに済む。
- Codexへの判断ノウハウをSkillとして独立・改善できる。
- 追加のLLM callなしでMap品質を上げられる。
- Source provenanceをblock構造へ直接結び付けやすい。

### Negative / Cost

- `MapSemanticKind`, `MapDraft`, `definition`, `table`等のschema追加が必要。
- App Server Skill lifecycle (`skills/extraRoots/set`, `skills/list`) をadapterで扱う必要がある。
- retrieval dynamic toolsとMap Draft submission toolを同一turn sessionで安全にroutingする必要がある。
- Codexがtoolを呼ばなかった場合のfallbackとtelemetryが必要。
- MapVersion schema / DB migrationが必要になる。

## Invariants

このADRによって以下は変更しない。

- 正常完了したAssistant responseは自動的にMapとして保存する。
- ユーザーへ手動Save / Promote操作を要求しない。
- `originTurnId`による冪等化を維持する。
- Map保存失敗でExplore回答そのものを失敗扱いにしない。
- Evidence / Source provenanceから元PDFへ戻れる。
- Visual Sourceでは画像自体を一次情報とする。
- 自由Canvasを初期版へ導入しない。

## Related documents

- `docs/concept.md`
- `docs/product-spec.md`
- `docs/maps-and-context-retrieval.md`
- `docs/architecture.md`
- `docs/plans/2026-08-15_Map品質改善計画.md`
