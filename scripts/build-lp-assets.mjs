import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, GlobalFonts, loadImage } from "@napi-rs/canvas";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = path.join(repoRoot, "apps/landing-page/public/og");
const productRoot = path.join(repoRoot, "apps/landing-page/public/product");

GlobalFonts.registerFromPath("/System/Library/Fonts/SFNS.ttf", "LensmapLatin");
GlobalFonts.registerFromPath("/System/Library/Fonts/Hiragino Sans GB.ttc", "LensmapJP");

const variants = [
  {
    locale: "ja",
    title: ["気になった一節から、", "理解の地図をつくる。"],
    body: "PDFの気になる箇所を集め、必要な文脈だけを広げて、根拠付きのMapとして残す。",
    caption: "4 references → Comparison Map",
  },
  {
    locale: "en",
    title: ["Turn passages into", "maps of understanding."],
    body: "Collect the passages that matter, expand only the context you need, and keep the result as a grounded Map.",
    caption: "4 references → Comparison Map",
  },
];

await fs.mkdir(outputRoot, { recursive: true });

for (const variant of variants) {
  const canvas = createCanvas(1200, 630);
  const ctx = canvas.getContext("2d");
  const productImage = await loadImage(path.join(productRoot, `pmbok-comparison-${variant.locale}.png`));

  ctx.fillStyle = "#f4f3ef";
  ctx.fillRect(0, 0, 1200, 630);

  ctx.fillStyle = "#171717";
  ctx.font = "25px LensmapLatin";
  ctx.fillText("Lensmap", 70, 82);

  ctx.font = variant.locale === "ja" ? "57px LensmapJP" : "60px LensmapLatin";
  ctx.fillText(variant.title[0], 70, 218);
  ctx.fillText(variant.title[1], 70, 290);

  ctx.fillStyle = "#68665f";
  ctx.font = variant.locale === "ja" ? "22px LensmapJP" : "21px LensmapLatin";
  wrapText(ctx, variant.body, 70, 354, 500, 35);

  ctx.fillStyle = "#77746d";
  ctx.font = "16px LensmapLatin";
  ctx.fillText("Focus → Expand → Map", 70, 538);

  drawProductMap(ctx, productImage, variant.caption);

  const output = path.join(outputRoot, `lensmap-og-${variant.locale}.png`);
  await fs.writeFile(output, canvas.toBuffer("image/png"));
  console.log(`[lp-assets] ${path.relative(repoRoot, output)} 1200x630`);
}

function drawProductMap(ctx, image, caption) {
  const x = 660;
  const y = 42;
  const width = 470;
  const height = 548;

  roundedRect(ctx, x, y, width, height, 24);
  ctx.fillStyle = "#1b1b1d";
  ctx.fill();
  ctx.strokeStyle = "rgba(23,23,23,0.16)";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.save();
  roundedRect(ctx, x + 1, y + 1, width - 2, height - 54, 23);
  ctx.clip();
  const sourceWidth = image.width;
  const sourceHeight = Math.min(image.height, Math.round(image.width * 0.88));
  ctx.drawImage(image, 0, 0, sourceWidth, sourceHeight, x + 1, y + 1, width - 2, height - 54);
  ctx.restore();

  ctx.fillStyle = "#9d9da2";
  ctx.font = "12px LensmapLatin";
  ctx.fillText(caption, x + 20, y + height - 20);
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const isJapanese = !text.includes(" ");
  const chunks = isJapanese ? Array.from(text) : text.split(" ");
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
