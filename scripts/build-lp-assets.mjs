import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, loadImage } from "@napi-rs/canvas";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = path.join(repoRoot, "apps/landing-page/public");
const outputRoot = path.join(publicRoot, "og");
const explorePath = path.join(publicRoot, "product/explore-response.png");

const variants = [
  {
    locale: "ja",
    title: ["気になった一節から、", "理解の地図をつくる。"],
    body: "PDFを読みながら選んだ箇所を起点に文脈を掘り、根拠付きの理解をMapとして残す。",
  },
  {
    locale: "en",
    title: ["Turn passages into", "maps of understanding."],
    body: "Explore only the context you need, then keep grounded understanding as reusable Maps.",
  },
];

await fs.mkdir(outputRoot, { recursive: true });
const explore = await loadImage(explorePath);

for (const variant of variants) {
  const canvas = createCanvas(1200, 630);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#f4f3ef";
  ctx.fillRect(0, 0, 1200, 630);

  const gradient = ctx.createRadialGradient(830, 90, 20, 830, 90, 520);
  gradient.addColorStop(0, "rgba(68, 122, 165, 0.12)");
  gradient.addColorStop(1, "rgba(68, 122, 165, 0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 1200, 630);

  ctx.fillStyle = "#171717";
  ctx.font = "600 25px -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.fillText("Lensmap", 74, 88);

  ctx.fillStyle = "#171717";
  ctx.font = variant.locale === "ja"
    ? "700 58px -apple-system, BlinkMacSystemFont, sans-serif"
    : "700 61px -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.fillText(variant.title[0], 74, 224);
  ctx.fillText(variant.title[1], 74, 296);

  ctx.fillStyle = "#68665f";
  ctx.font = variant.locale === "ja"
    ? "400 24px -apple-system, BlinkMacSystemFont, sans-serif"
    : "400 23px -apple-system, BlinkMacSystemFont, sans-serif";
  wrapText(ctx, variant.body, 74, 368, 520, 37);

  ctx.fillStyle = "#77746d";
  ctx.font = "600 17px -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.fillText("Focus → Expand → Map", 74, 536);

  const frameX = 760;
  const frameY = 38;
  const frameW = 360;
  const frameH = 554;
  roundedRect(ctx, frameX, frameY, frameW, frameH, 22);
  ctx.fillStyle = "#1c1c1e";
  ctx.fill();
  ctx.save();
  roundedRect(ctx, frameX, frameY, frameW, frameH, 22);
  ctx.clip();
  const sourceRatio = explore.width / explore.height;
  const drawH = frameH;
  const drawW = drawH * sourceRatio;
  ctx.drawImage(explore, frameX + (frameW - drawW) / 2, frameY, drawW, drawH);
  ctx.restore();

  ctx.strokeStyle = "rgba(23,23,23,0.13)";
  ctx.lineWidth = 1;
  roundedRect(ctx, frameX, frameY, frameW, frameH, 22);
  ctx.stroke();

  const output = path.join(outputRoot, `lensmap-og-${variant.locale}.png`);
  await fs.writeFile(output, canvas.toBuffer("image/png"));
  console.log(`[lp-assets] ${path.relative(repoRoot, output)} 1200x630`);
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
