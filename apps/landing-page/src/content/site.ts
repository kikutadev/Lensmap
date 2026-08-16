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
  navInstall: string;
  navFaq: string;
  navPrivacy: string;
  heroHint: string;
  ownershipTitle: string;
  focusTitle: string;
  focusBody: string;
  expandTitle: string;
  expandBody: string;
  mapTitle: string;
  mapBody: string;
  chatEyebrow: string;
  chatTitle: string;
  chatBody: string;
  mapsEyebrow: string;
  mapsTitle: string;
  mapsBody: string;
  mapExampleEyebrow: string;
  mapExampleTitle: string;
  mapExampleBody: string;
  mapExampleSelected: string;
  mapExampleOutcome: string;
  mapExampleEvidence: string;
  mapExampleAlt: string;
  mapExampleCaption: string;
  mapSourceLead: string;
  mapSourceTail: string;
  selectedEvidenceLabel: string;
  groundedTitle: string;
  groundedBody: string;
  localTitle: string;
  localBody: string;
  codexEyebrow: string;
  codexTitle: string;
  codexBody: string;
  codexPoint1: string;
  codexPoint2: string;
  codexPoint3: string;
  installEyebrow: string;
  installTitle: string;
  installBody: string;
  installStep1Title: string;
  installStep1Body: string;
  installStep2Title: string;
  installStep2Body: string;
  installStep3Title: string;
  installStep3Body: string;
  installStep4Title: string;
  installStep4Body: string;
  installNote: string;
  sourceLabel: string;
  aiAddedLabel: string;
  mapSavedLabel: string;
  faqEyebrow: string;
  faqTitle: string;
  faqItems: Array<{ question: string; answer: string }>;
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
    navInstall: "インストール",
    navFaq: "FAQ",
    navPrivacy: "Privacy",
    heroHint: "Chrome標準PDF Viewerをそのまま使います。",
    ownershipTitle: "読書の主導権は、あなたに。",
    focusTitle: "Focus",
    focusBody: "まず決めるのはAIではなく、あなたです。気になった一節や図表を選ぶところから始まります。",
    expandTitle: "Expand",
    expandBody: "選択箇所だけで足りないときだけ、前後・同じ節・関連箇所へ文脈を広げます。何を追加で読んだかも残ります。",
    mapTitle: "Map",
    mapBody: "得られた理解は自動でMapとして残ります。図、表、比較、短い説明など、内容に合う形でEvidenceと一緒に再利用できます。",
    chatEyebrow: "Chat is a scratchpad",
    chatTitle: "AIとのチャットは、あくまでサブ。",
    chatBody: "考えを整理したいとき、言葉にして確かめたいとき、メモ帳のようにチャットしてください。会話ログを貯めることが目的ではありません。残したい理解はMapになり、あとからEvidenceと一緒に見返せます。",
    mapsEyebrow: "会話はメモ。Mapが成果物。",
    mapsTitle: "あとから見ても、なぜそう理解したかが分かる。",
    mapsBody: "会話ログの見栄えではなく、読んだ内容がどう理解につながったかを残します。下はデモ用の作り物ではなく、公開PDFをLensmapで実際に読み、現在のMap Composerが生成したMapです。",
    mapExampleEyebrow: "REAL MAP · REAL PDF",
    mapExampleTitle: "4つの読書箇所が、1つの比較Mapになる。",
    mapExampleBody: "P3.express / PRINCE2 / Scrum / PM²について気になった4箇所を同じWorkspaceに追加し、『この本の中での位置づけを比較して』と質問。Lensmapは4つのEvidenceを根拠に、対象範囲・位置づけ・Tailoringを見比べられるMapを生成しました。",
    mapExampleSelected: "あなたが選んだ参照",
    mapExampleOutcome: "Comparison Map",
    mapExampleEvidence: "Mapに残ったEvidence",
    mapExampleAlt: "Lensmapで実際に生成した、P3.express、PRINCE2、Scrum、PM²を比較するMap詳細画面",
    mapExampleCaption: "実際のLensmap Map詳細画面。S1〜S4のEvidenceから該当PDFページへ戻れます。",
    mapSourceLead: "Example source: ",
    mapSourceTail: " — CC BY。MapはLensmapによる要約・構造化です。書籍内容は著者個人の見解であり、PMIの見解を示すものではありません。PMBOK®はProject Management Institute, Inc.の登録商標です。",
    selectedEvidenceLabel: "あなたが選択",
    groundedTitle: "根拠を失わない",
    groundedBody: "自分が選んだ箇所と、AIが追加で参照した箇所を区別。Citationから元のPDFへ戻れるので、AIの説明だけが独り歩きしません。",
    localTitle: "Local-first",
    localBody: "PDF、索引、Explore、Mapsはローカル保存が基本です。AIへ送るのは質問と、その回答に必要な参照・文脈に限定します。",
    codexEyebrow: "AI runtime",
    codexTitle: "AI実行にはCodex App Serverを使います。",
    codexBody: "Lensmapはブラウザから外部AI APIへ直接PDFを投げる構成ではありません。ローカルのLensmap ServerがCodex App Serverと接続し、現在のReader Workspaceに必要なEvidenceだけを渡します。",
    codexPoint1: "ChatGPT Mac appまたはCodex CLIで認証済みのCodexを利用",
    codexPoint2: "model選択、Context利用状況、利用枠をSide Panelから確認",
    codexPoint3: "Visual Sourceは画像入力対応modelへ画像そのものを渡す",
    installEyebrow: "Open source · Apache-2.0",
    installTitle: "インストールは、Chrome拡張を読み込むところまで約4ステップ。",
    installBody: "配布版はmacOS Apple Silicon向けです。Node.js runtimeは配布ZIPに同梱するため、通常利用ではNode.jsやnpmの事前インストールは不要です。",
    installStep1Title: "Release ZIPを取得",
    installStep1Body: "GitHub ReleasesからmacOS arm64版ZIPをダウンロードして展開します。",
    installStep2Title: "install.commandを実行",
    installStep2Body: "Lensmap Server、Native Host、Chrome拡張の実行ファイルをユーザー領域へ配置します。管理者権限は不要です。",
    installStep3Title: "Chromeへ読み込む",
    installStep3Body: "chrome://extensions でDeveloper modeを有効にし、案内されたLensmap拡張フォルダをLoad unpackedで読み込みます。",
    installStep4Title: "Codexへサインイン",
    installStep4Body: "ChatGPT Mac appまたはCodex CLIでChatGPT/Codexへ認証済みなら、そのままLensmapから利用できます。",
    installNote: "現在は初回Release準備中です。ソースから試す場合はREADMEの開発セットアップを利用できます。",
    sourceLabel: "あなたが選択",
    aiAddedLabel: "AIが追加参照",
    mapSavedLabel: "Mapsに自動保存",
    faqEyebrow: "FAQ",
    faqTitle: "よくある質問",
    faqItems: [
      { question: "AIチャットツールですか？", answer: "チャットは補助です。読む箇所を決めるのはあなたで、チャットは理解を整理するメモ帳として使います。Lensmapの成果物は、Evidenceと元PDFへの導線を持つMapです。" },
      { question: "PDF全体がAIへアップロードされますか？", answer: "基本設計はLocal-firstです。PDFと索引はローカルに保持し、Codexへは現在の質問に必要なEvidenceと、限定された追加文脈を渡します。" },
      { question: "どのAIを使いますか？", answer: "Codex App ServerをAI runtimeとして利用します。ChatGPT Mac appまたはCodex CLIで認証済みの環境を前提にしています。" },
      { question: "ChromeのPDF Viewerを置き換えますか？", answer: "置き換えません。Chrome標準PDF Viewerをそのまま読み物の画面として使い、LensmapはSide Panelに並びます。" },
      { question: "ローカルPDFも読めますか？", answer: "読めます。ChromeのLensmap拡張詳細で「ファイルのURLへのアクセスを許可する」を有効にしてください。" },
      { question: "対応環境は？", answer: "現在の配布対象はmacOS Apple SiliconとGoogle Chrome 141以上です。" },
    ],
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
    navInstall: "Install",
    navFaq: "FAQ",
    navPrivacy: "Privacy",
    heroHint: "Keep using Chrome’s built-in PDF Viewer.",
    ownershipTitle: "You stay in control of the reading.",
    focusTitle: "Focus",
    focusBody: "You choose what deserves attention. Start from a passage or visual region instead of asking AI to read the whole document for you.",
    expandTitle: "Expand",
    expandBody: "When the selection is not enough, Lensmap can read nearby blocks, the same section, or related passages—and records what it added.",
    mapTitle: "Map",
    mapBody: "What you learn is retained automatically as a Map: diagrams, tables, comparisons, concise explanations, and Evidence in the form that fits the idea.",
    chatEyebrow: "Chat is a scratchpad",
    chatTitle: "AI chat is deliberately secondary.",
    chatBody: "Use it like a notepad when you want to put an idea into words or test your understanding. The goal is not to accumulate chat logs. Understanding worth keeping becomes a Map that you can revisit with its Evidence.",
    mapsEyebrow: "Chat is the scratchpad. The Map is the outcome.",
    mapsTitle: "Come back later and still know why it made sense.",
    mapsBody: "The point is not to make chat logs look prettier. A Map keeps how the reading became understanding. The example below is not a marketing mock: it was generated by the current Lensmap Map Composer from a real public PDF.",
    mapExampleEyebrow: "REAL MAP · REAL PDF",
    mapExampleTitle: "Four passages become one comparison Map.",
    mapExampleBody: "Four passages about P3.express, PRINCE2, Scrum, and PM² were added to one Workspace, then Lensmap was asked to compare how the book positions them. The resulting Map keeps scope, positioning, and tailoring implications together with four pieces of Evidence.",
    mapExampleSelected: "passages selected by the reader",
    mapExampleOutcome: "Comparison Map",
    mapExampleEvidence: "Evidence retained in the Map",
    mapExampleAlt: "Actual Lensmap Map detail comparing P3.express, PRINCE2, Scrum, and PM²",
    mapExampleCaption: "Actual Lensmap Map detail. Evidence S1–S4 links back to the corresponding PDF pages.",
    mapSourceLead: "Example source: ",
    mapSourceTail: " — CC BY. The Map is a Lensmap-generated summary and structure. The book reflects the author’s personal views, not PMI’s. PMBOK® is a registered mark of Project Management Institute, Inc.",
    selectedEvidenceLabel: "Selected by you",
    groundedTitle: "Keep the evidence",
    groundedBody: "Lensmap distinguishes what you selected from context added by AI. Citations lead back to the original PDF, so the explanation never becomes detached from its source.",
    localTitle: "Local-first",
    localBody: "PDFs, indexes, Explore threads, and Maps stay local by default. Only the question and the references needed to answer it are sent to AI.",
    codexEyebrow: "AI runtime",
    codexTitle: "Lensmap runs AI through Codex App Server.",
    codexBody: "The browser does not upload your PDF directly to a generic AI API. A local Lensmap Server connects to Codex App Server and supplies only the Evidence needed for the current Reader Workspace.",
    codexPoint1: "Uses Codex authenticated through the ChatGPT Mac app or Codex CLI",
    codexPoint2: "Shows model selection, Context usage, and usage windows in the Side Panel",
    codexPoint3: "Sends the actual image to an image-capable model for Visual Sources",
    installEyebrow: "Open source · Apache-2.0",
    installTitle: "From the release ZIP to Chrome in about four steps.",
    installBody: "The packaged release targets macOS Apple Silicon. A verified Node.js runtime is bundled, so normal installation does not require Node.js, npm, or Git.",
    installStep1Title: "Get the release ZIP",
    installStep1Body: "Download and extract the macOS arm64 bundle from GitHub Releases.",
    installStep2Title: "Run install.command",
    installStep2Body: "It installs Lensmap Server, the Native Host, and extension files in your user directory without administrator privileges.",
    installStep3Title: "Load it in Chrome",
    installStep3Body: "Enable Developer mode at chrome://extensions and Load unpacked from the installed Lensmap extension directory.",
    installStep4Title: "Sign in to Codex",
    installStep4Body: "If the ChatGPT Mac app or Codex CLI is already authenticated with ChatGPT/Codex, Lensmap can use that session.",
    installNote: "The first release is currently being prepared. To try the source build now, follow the development setup in the README.",
    sourceLabel: "Selected by you",
    aiAddedLabel: "Added by AI",
    mapSavedLabel: "Saved to Maps automatically",
    faqEyebrow: "FAQ",
    faqTitle: "Frequently asked questions",
    faqItems: [
      { question: "Is Lensmap an AI chat app?", answer: "Chat is a supporting tool. You decide what to read; chat acts like a scratchpad for organizing understanding. The durable outcome is a Map with Evidence and links back to the PDF." },
      { question: "Does Lensmap upload the entire PDF to AI?", answer: "The design is local-first. PDFs and indexes remain local, while Codex receives the Evidence needed for the current question plus constrained additional context when required." },
      { question: "Which AI runtime does it use?", answer: "Lensmap uses Codex App Server and expects Codex to be authenticated through the ChatGPT Mac app or Codex CLI." },
      { question: "Does it replace Chrome’s PDF Viewer?", answer: "No. Chrome’s built-in PDF Viewer remains the reading surface and Lensmap sits beside it in the Side Panel." },
      { question: "Can it read local PDFs?", answer: "Yes. Enable “Allow access to file URLs” in the Lensmap extension details in Chrome." },
      { question: "What platforms are supported?", answer: "The current packaged target is macOS Apple Silicon with Google Chrome 141 or later." },
    ],
    footerLine: "AI is the lens. The map is the outcome.",
  },
};
