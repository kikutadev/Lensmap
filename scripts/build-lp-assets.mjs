import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas } from "@napi-rs/canvas";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = path.join(repoRoot, "apps/landing-page/public/og");

const variants = [
  {
    locale: "ja",
    title: ["気になった一節から、", "理解の地図をつくる。"],
    body: "PDFを読みながら選んだ箇所を起点に文脈を掘り、根拠付きの理解をMapとして残す。",
    evidenceSelected: "あなたが選択",
    evidenceAdded: "AIが追加参照",
    definition: "更新後に古くなったキャッシュを無効化し、古い値を返さないようにする仕組み。",
  },
  {
    locale: "en",
    title: ["Turn passages into", "maps of understanding."],
    body: "Explore only the context you need, then keep grounded understanding as reusable Maps.",
    evidenceSelected: "Selected by you",
    evidenceAdded: "Added by AI",
    definition: "Invalidate stale cached copies after an update so later reads do not return outdated data.",
  },
];

await fs.mkdir(outputRoot, { recursive: true });

for (const variant of variants) {
  const canvas = createCanvas(1200, 630);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#f4f3ef";
  ctx.fillRect(0, 0, 1200, 630);

  const gradient = ctx.createRadialGradient(865, 96, 20, 865, 96, 520);
  gradient.addColorStop(0, "rgba(68, 122, 165, 0.13)");
  gradient.addColorStop(1, "rgba(68, 122, 165, 0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 1200, 630);

  ctx.fillStyle = "#171717";
  ctx.font = "600 25px -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.fillText("Lensmap", 74, 88);

  ctx.font = variant.locale === "ja"
    ? "700 58px -apple-system, BlinkMacSystemFont, sans-serif"
    : "700 61px -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.fillText(variant.title[0], 74, 224);
  ctx.fillText(variant.title[1], 74, 296);

  ctx.fillStyle = "#68665f";
  ctx.font = variant.locale === "ja"
    ? "400 24px -apple-system, BlinkMacSystemFont, sans-serif"
    : "400 23px -apple-system, BlinkMacSystemFont, sans-serif";
  wrapText(ctx, variant.body, 74, 368, 515, 37);

  ctx.fillStyle = "#77746d";
  ctx.font = "600 17px -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.fillText("Focus → Expand → Map", 74, 536);

  drawMapCard(ctx, variant);

  const output = path.join(outputRoot, `lensmap-og-${variant.locale}.png`);
  await fs.writeFile(output, canvas.toBuffer("image/png"));
  console.log(`[lp-assets] ${path.relative(repoRoot, output)} 1200x630`);
}

/** Draw a resolution-independent Map anatomy instead of embedding a product screenshot. */
function drawMapCard(ctx, variant) {
  const x = 710;
  const y = 48;
  const width = 416;
  const height = 534;

  roundedRect(ctx, x, y, width, height, 24);
  ctx.fillStyle = "#fbfaf7";
  ctx.fill();
  ctx.strokeStyle = "rgba(23,23,23,0.14)";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = "#85827b";
  ctx.font = "700 11px -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.fillText("MAP · DEFINITION", x + 28, y + 38);

  ctx.fillStyle = "#171717";
  ctx.font = "700 31px -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.fillText("Cache invalidation", x + 28, y + 82);

  ctx.fillStyle = "#66645e";
  ctx.font = variant.locale === "ja"
    ? "500 15px -apple-system, BlinkMacSystemFont, sans-serif"
    : "500 14px -apple-system, BlinkMacSystemFont, sans-serif";
  wrapText(ctx, variant.definition, x + 28, y + 120, width - 56, 23);

  ctx.strokeStyle = "rgba(23,23,23,0.10)";
  ctx.beginPath();
  ctx.moveTo(x + 28, y + 196);
  ctx.lineTo(x + width - 28, y + 196);
  ctx.stroke();

  drawEvidence(ctx, x + 28, y + 224, width - 56, "S1 · PDF p.42", variant.evidenceSelected, "A stale cached copy must not be returned after the source value has changed.", true);
  drawEvidence(ctx, x + 28, y + 342, width - 56, "S2 · PDF p.68", variant.evidenceAdded, "Invalidation marks a cached representation as unusable so the next read obtains a fresh value.", false);

  ctx.fillStyle = "#1670cf";
  ctx.font = "650 12px -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.fillText(variant.locale === "ja" ? "Evidenceから元PDFへ戻る ↗" : "Back to the source PDF ↗", x + 28, y + 500);
}

function drawEvidence(ctx, x, y, width, label, provenance, quote, selected) {
  roundedRect(ctx, x, y, width, 100, 12);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.strokeStyle = "rgba(23,23,23,0.10)";
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(x + 15, y + 19, 3, 0, Math.PI * 2);
  ctx.fillStyle = selected ? "#1670cf" : "#8a8882";
  ctx.fill();

  ctx.fillStyle = "#171717";
  ctx.font = "700 10px -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.fillText(label, x + 25, y + 23);

  ctx.fillStyle = "#89867f";
  ctx.font = "500 9px -apple-system, BlinkMacSystemFont, sans-serif";
  const provenanceWidth = ctx.measureText(provenance).width;
  ctx.fillText(provenance, x + width - provenanceWidth - 12, y + 23);

  ctx.fillStyle = "#66645e";
  ctx.font = "400 11px Georgia, serif";
  wrapText(ctx, `“${quote}”`, x + 14, y + 50, width - 28, 17);
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = text.split(" ");
  const isJapanese = !text.includes(" ");
  const chunks = isJapanese ? Array.from(text) : words;
  let line = "";
  let currentY = y;
  for (const chunk of chunks) {
    const candidate = isJapanese ? `${line}${chunk}` : line ? `${line} ${chunk}` : chunk;
    if (ctx.measureText(candidate).width > maxWidth && line) {
      ctx.fillText(line, x, currentY);
      line = chunk;
      currentY += lineHeight;
    } else {
      line = candidate;
    }
  }
  if (line) ctx.fillText(line, x, currentY);
}

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}
