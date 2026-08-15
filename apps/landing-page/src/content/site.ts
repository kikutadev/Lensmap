export type Locale = "ja" | "en";

export interface SiteCopy {
  lang: string;
  title: string;
  description: string;
  eyebrow: string;
  heroTitle: string;
  heroBody: string;
  primaryCta: string;
  secondaryCta: string;
  navHow: string;
  navMaps: string;
  navPrivacy: string;
  heroHint: string;
  focusTitle: string;
  focusBody: string;
  expandTitle: string;
  expandBody: string;
  mapTitle: string;
  mapBody: string;
  mapsEyebrow: string;
  mapsTitle: string;
  mapsBody: string;
  groundedTitle: string;
  groundedBody: string;
  localTitle: string;
  localBody: string;
  installEyebrow: string;
  installTitle: string;
  installBody: string;
  installNote: string;
  sourceLabel: string;
  aiAddedLabel: string;
  mapSavedLabel: string;
  footerLine: string;
}

export const copy: Record<Locale, SiteCopy> = {
  ja: {
    lang: "ja",
    title: "Lensmap — 気になった一節から、理解の地図をつくる。",
    description: "PDFを読みながら選んだ箇所を起点に文脈を掘り、根拠付きの理解をMapとして残すローカル読書ツール。",
    eyebrow: "PDFを読む。そのまま、深く理解する。",
    heroTitle: "気になった一節から、\n理解の地図をつくる。",
    heroBody: "Lensmapは、PDF全体をAIに丸投げするためのツールではありません。読んでいる一節を起点に必要な文脈だけを広げ、得られた理解を原文へ戻れるMapとして残します。",
    primaryCta: "GitHubで見る",
    secondaryCta: "仕組みを見る",
    navHow: "仕組み",
    navMaps: "Maps",
    navPrivacy: "Privacy",
    heroHint: "Chrome標準PDF Viewerをそのまま使います。",
    focusTitle: "Focus",
    focusBody: "まず決めるのはAIではなく、あなたです。気になった一節や図表を選ぶところから始まります。",
    expandTitle: "Expand",
    expandBody: "選択箇所だけで足りないときだけ、前後・同じ節・関連箇所へ文脈を広げます。何を追加で読んだかも残ります。",
    mapTitle: "Map",
    mapBody: "回答は自動でMapとして残ります。図、表、比較、短い説明。内容に合った形で、根拠と一緒に再利用できます。",
    mapsEyebrow: "会話は過程。Mapが成果物。",
    mapsTitle: "あとから見ても、なぜそう理解したかが分かる。",
    mapsBody: "Mapは綺麗な図だけではありません。Visual、短い説明、Evidence、PDFへのbacklinkをひとまとまりにして、読書中に得た理解を再構成できる形で保存します。",
    groundedTitle: "根拠を失わない",
    groundedBody: "自分が選んだ箇所と、AIが追加で参照した箇所を区別。Citationから元のPDFへ戻れるので、AIの説明だけが独り歩きしません。",
    localTitle: "Local-first",
    localBody: "PDF、索引、Explore、Mapsはローカル保存が基本です。AIへ送るのは質問と、その回答に必要な参照・文脈に限定します。",
    installEyebrow: "Open source · Apache-2.0",
    installTitle: "読み方を置き換えず、読書の横に置く。",
    installBody: "LensmapはChrome拡張として動作し、表示にはChrome標準PDF Viewerを使います。macOS Apple Silicon向けの配布をGitHub Releasesで行います。",
    installNote: "現在は初回リリース準備中です。ソースコードと開発状況はGitHubで公開しています。",
    sourceLabel: "あなたが選択",
    aiAddedLabel: "AIが追加参照",
    mapSavedLabel: "Mapsに自動保存",
    footerLine: "AI is the lens. The map is the outcome.",
  },
  en: {
    lang: "en",
    title: "Lensmap — Turn passages into maps of understanding.",
    description: "A local-first PDF reading tool that expands context from the passage you choose and keeps grounded understanding as reusable Maps.",
    eyebrow: "Read the PDF. Go deeper without leaving it.",
    heroTitle: "Turn passages into\nmaps of understanding.",
    heroBody: "Lensmap is not a full-document AI autopilot. Start from the passage you are actually reading, expand only the context you need, and keep what you learn as Maps that lead back to the source.",
    primaryCta: "View on GitHub",
    secondaryCta: "See how it works",
    navHow: "How it works",
    navMaps: "Maps",
    navPrivacy: "Privacy",
    heroHint: "Keep using Chrome’s built-in PDF Viewer.",
    focusTitle: "Focus",
    focusBody: "You choose what deserves attention. Start from a passage or visual region instead of asking AI to read the whole document for you.",
    expandTitle: "Expand",
    expandBody: "When the selection is not enough, Lensmap can read nearby blocks, the same section, or related passages—and records what it added.",
    mapTitle: "Map",
    mapBody: "Completed answers are retained automatically as Maps: diagrams, tables, comparisons, concise explanations, and evidence in the form that fits the idea.",
    mapsEyebrow: "Conversation is the process. The Map is the outcome.",
    mapsTitle: "Come back later and still know why it made sense.",
    mapsBody: "A Map is more than a pretty diagram. It combines visual understanding, a concise explanation, evidence, and backlinks to the PDF so the reasoning can be reconstructed later.",
    groundedTitle: "Keep the evidence",
    groundedBody: "Lensmap distinguishes what you selected from context added by AI. Citations lead back to the original PDF, so the explanation never becomes detached from its source.",
    localTitle: "Local-first",
    localBody: "PDFs, indexes, Explore threads, and Maps stay local by default. Only the question and the references needed to answer it are sent to AI.",
    installEyebrow: "Open source · Apache-2.0",
    installTitle: "A reading companion, not a replacement reader.",
    installBody: "Lensmap runs as a Chrome extension while Chrome’s built-in PDF Viewer remains the reading surface. Distribution for macOS Apple Silicon is planned through GitHub Releases.",
    installNote: "The first public release is being prepared. Source code and current development are available on GitHub now.",
    sourceLabel: "Selected by you",
    aiAddedLabel: "Added by AI",
    mapSavedLabel: "Saved to Maps automatically",
    footerLine: "AI is the lens. The map is the outcome.",
  },
};
