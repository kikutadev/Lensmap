import type { ExploreMessageSource } from "@lensmap/shared";
import { useEffect, useState } from "react";
import { fetchVisualSourceAsset } from "../../../lib/api";

export function SourceReference({ source, onOpen, variant = "inline" }: {
  source: ExploreMessageSource;
  onOpen: (source: ExploreMessageSource) => void;
  variant?: "inline" | "chip";
}) {
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  useEffect(() => {
    if (source.kind !== "visual") return;
    const controller = new AbortController();
    let objectUrl: string | null = null;
    void fetchVisualSourceAsset(source.bookId, source.imageAssetId, controller.signal)
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        setThumbnailUrl(objectUrl);
      })
      .catch(() => undefined);
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [source]);

  if (source.kind === "visual") {
    const page = source.page === null ? "PDF page unresolved" : `PDF p.${source.page + 1}`;
    const text = compactQuote(source.recognizedText ?? "Visual Source", variant === "chip" ? 54 : 180);
    const canOpen = source.page !== null;
    return (
      <span className={`source-reference visual ${variant}`}>
        <button
          type="button"
          className="source-reference-trigger"
          disabled={!canOpen}
          onClick={() => { if (canOpen) onOpen(source); }}
          aria-label={`${source.label}、Visual、${page}。${text}`}
        >
          <strong>{source.label}</strong>
          {thumbnailUrl ? <img className="source-reference-thumbnail" src={thumbnailUrl} alt="" /> : null}
          {variant === "chip" ? <><span className="source-reference-page">Visual · {page}</span><span className="source-reference-snippet">{text}</span></> : null}
        </button>
        <span className="source-reference-popover" role="tooltip">
          <span className="source-reference-popover-head"><strong>{source.label}</strong><span>Visual · {page}</span><em>{source.origin === "ai-expansion" ? "AIが追加参照" : "選択画像"}</em></span>
          {thumbnailUrl ? <img className="source-reference-preview" src={thumbnailUrl} alt="保存済みVisual Source" /> : null}
          <span className="source-reference-popover-quote">{source.recognizedText ? `OCR: ${compactQuote(source.recognizedText, 240)}` : "画像そのものが一次根拠です。"}</span>
          <small>{canOpen ? "クリックすると該当PDFページを開きます。" : "PDFページはまだ再同定されていません。"}</small>
        </span>
      </span>
    );
  }

  const page = source.printedPageLabelStart?.trim()
    ? `p.${source.printedPageLabelStart} / PDF p.${source.pageStart + 1}`
    : `PDF p.${source.pageStart + 1}`;
  const quote = compactQuote(source.quoteRaw, variant === "chip" ? 54 : 180);

  return (
    <span className={`source-reference ${variant}`}>
      <button type="button" className="source-reference-trigger" onClick={() => onOpen(source)} aria-label={`${source.label}、${page}。${quote}`}>
        <strong>{source.label}</strong>
        {variant === "chip" ? <><span className="source-reference-page">{page}</span><span className="source-reference-snippet">“{quote}”</span></> : null}
        {variant === "chip" && source.origin === "ai-expansion" ? <span className="source-origin-badge">AI追加</span> : null}
      </button>
      <span className="source-reference-popover" role="tooltip">
        <span className="source-reference-popover-head"><strong>{source.label}</strong><span>{page}</span>{source.origin === "ai-expansion" ? <em>AIが追加参照</em> : <em>選択箇所</em>}</span>
        <span className="source-reference-popover-quote">“{compactQuote(source.quoteRaw, 240)}”</span>
        <small>クリックすると該当PDFページを開きます。</small>
      </span>
    </span>
  );
}

function compactQuote(value: string, maxLength: number): string {
  const compact = value.replace(/\s+/gu, " ").trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}
