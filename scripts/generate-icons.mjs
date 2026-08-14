#!/usr/bin/env node
/* global console */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { createCanvas, loadImage } from "@napi-rs/canvas";

const root = process.cwd();
const sourcePath = resolve(root, process.argv[2] ?? "assets/branding/icon-source.png");
const extensionDir = resolve(root, "apps/chrome-extension/public/icons");
const releaseDir = resolve(root, "assets/release");
const extensionSizes = [16, 32, 48, 128];
const releaseSizes = [256, 512, 1024];

mkdirSync(extensionDir, { recursive: true });
mkdirSync(releaseDir, { recursive: true });

const image = await loadImage(readFileSync(sourcePath));
if (image.width !== image.height) {
  throw new Error(`Icon source must be square: ${image.width}x${image.height}`);
}

const normalized = createCanvas(image.width, image.height);
const normalizedContext = normalized.getContext("2d");
normalizedContext.drawImage(image, 0, 0);
removeNearBlackBackground(normalizedContext, image.width, image.height);

for (const size of extensionSizes) {
  writePng(resolve(extensionDir, `icon-${size}.png`), renderSquare(normalized, size));
}
for (const size of releaseSizes) {
  writePng(resolve(releaseDir, `lensmap-icon-${size}.png`), renderSquare(normalized, size));
}

console.log(JSON.stringify({
  source: sourcePath,
  sourceSize: `${image.width}x${image.height}`,
  extensionIcons: extensionSizes,
  releaseIcons: releaseSizes,
  background: "transparent",
}, null, 2));

/**
 * Convert the generated-image black matte into transparency while preserving the dark-blue artwork.
 * The source has an opaque near-black outer background; blue icon pixels remain well above this threshold.
 */
function removeNearBlackBackground(context, width, height) {
  const imageData = context.getImageData(0, 0, width, height);
  const data = imageData.data;

  for (let index = 0; index < data.length; index += 4) {
    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    const brightest = Math.max(red, green, blue);

    // Feather only pixels that are genuinely near black. This removes the matte without erasing navy details.
    if (brightest <= 18) {
      data[index + 3] = 0;
    } else if (brightest < 48) {
      data[index + 3] = Math.round(((brightest - 18) / 30) * 255);
    }
  }

  context.putImageData(imageData, 0, 0);
}

/** Render one high-quality square icon from the normalized transparent master. */
function renderSquare(sourceCanvas, size) {
  const canvas = createCanvas(size, size);
  const context = canvas.getContext("2d");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.clearRect(0, 0, size, size);
  context.drawImage(sourceCanvas, 0, 0, size, size);
  return canvas.toBuffer("image/png");
}

function writePng(path, buffer) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, buffer);
}
