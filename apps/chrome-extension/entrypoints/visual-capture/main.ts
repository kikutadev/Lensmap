import type { NormalizedRect } from "@lensmap/shared";
import { browser } from "wxt/browser";
import { addWorkspaceSource, createVisualSource } from "../../lib/api";
import { dragToNormalizedRect, normalizedRectToPixelCrop, type Point } from "../../lib/visual-capture";

interface CapturePayload {
  captureId: string;
  dataUrl: string;
  originTabId: number;
  bookId: string;
  workspaceId: string;
}

const image = requireElement<HTMLImageElement>("capture-image");
const surface = requireElement<HTMLElement>("surface");
const selection = requireElement<HTMLElement>("selection");
const saveButton = requireElement<HTMLButtonElement>("save");
const cancelButton = requireElement<HTMLButtonElement>("cancel");
const loading = requireElement<HTMLElement>("loading");
const status = requireElement<HTMLElement>("status");
const captureId = new URL(location.href).searchParams.get("captureId");

let payload: CapturePayload | null = null;
let dragStart: Point | null = null;
let normalizedRect: NormalizedRect | null = null;
let saving = false;

void initialize();

async function initialize(): Promise<void> {
  if (!captureId) return fail("Capture IDがありません");
  try {
    const response = await browser.runtime.sendMessage({ type: "get-visual-capture", captureId }) as { ok?: boolean; capture?: CapturePayload; error?: string };
    if (!response?.ok || !response.capture) throw new Error(response?.error ?? "キャプチャ画像を取得できませんでした");
    payload = response.capture;
    image.addEventListener("load", () => {
      loading.hidden = true;
      image.hidden = false;
      status.textContent = "画像上をドラッグして範囲を指定してください。";
    }, { once: true });
    image.src = payload.dataUrl;
  } catch (error: unknown) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

surface.addEventListener("pointerdown", (event) => {
  if (!payload || image.hidden || saving) return;
  const bounds = image.getBoundingClientRect();
  if (!isInside(event.clientX, event.clientY, bounds)) return;
  dragStart = { x: event.clientX, y: event.clientY };
  normalizedRect = null;
  saveButton.disabled = true;
  surface.setPointerCapture(event.pointerId);
  renderSelection(dragStart, dragStart, bounds);
});

surface.addEventListener("pointermove", (event) => {
  if (!dragStart || saving) return;
  renderSelection(dragStart, { x: event.clientX, y: event.clientY }, image.getBoundingClientRect());
});

surface.addEventListener("pointerup", (event) => {
  if (!dragStart || saving) return;
  const bounds = image.getBoundingClientRect();
  const end = { x: event.clientX, y: event.clientY };
  normalizedRect = dragToNormalizedRect(dragStart, end, bounds);
  dragStart = null;
  if (!normalizedRect) {
    selection.hidden = true;
    saveButton.disabled = true;
    status.textContent = "もう少し大きい範囲を選択してください。";
    return;
  }
  renderNormalizedSelection(normalizedRect, bounds);
  saveButton.disabled = false;
  status.textContent = "この範囲をVisual Sourceとして参照に追加できます。";
});

saveButton.addEventListener("click", () => { void saveSelection(); });
cancelButton.addEventListener("click", () => { void finish(false); });
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") void finish(false);
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && !saveButton.disabled) void saveSelection();
});

async function saveSelection(): Promise<void> {
  if (!payload || !normalizedRect || saving) return;
  saving = true;
  saveButton.disabled = true;
  cancelButton.disabled = true;
  status.classList.remove("error");
  status.textContent = "Visual Sourceを保存しています…";
  try {
    const png = await cropPng(image, normalizedRect);
    const source = await createVisualSource(payload.bookId, {
      captureImageWidthPx: image.naturalWidth,
      captureImageHeightPx: image.naturalHeight,
      captureRectNormalized: normalizedRect,
      locationStatus: "unresolved",
      documentNodeIds: [],
    }, png);
    await addWorkspaceSource(payload.workspaceId, source.id);
    await browser.storage.local.set({ "lensmap.workspaceRevision": Date.now() });
    await finish(true, source.id);
  } catch (error: unknown) {
    saving = false;
    saveButton.disabled = false;
    cancelButton.disabled = false;
    fail(error instanceof Error ? error.message : String(error));
  }
}

async function cropPng(sourceImage: HTMLImageElement, rect: NormalizedRect): Promise<Blob> {
  const crop = normalizedRectToPixelCrop(rect, sourceImage.naturalWidth, sourceImage.naturalHeight);
  const canvas = document.createElement("canvas");
  canvas.width = crop.width;
  canvas.height = crop.height;
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) throw new Error("画像の切り出しを開始できませんでした");
  context.drawImage(sourceImage, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("PNGの生成に失敗しました");
  return blob;
}

async function finish(committed: boolean, sourceId?: string): Promise<void> {
  if (!captureId) return window.close();
  try {
    await browser.runtime.sendMessage({ type: "finish-visual-capture", captureId, committed, sourceId });
  } finally {
    window.close();
  }
}

function renderSelection(start: Point, end: Point, bounds: DOMRect): void {
  const rect = dragToNormalizedRect(start, end, bounds);
  if (!rect) {
    const left = Math.max(bounds.left, Math.min(start.x, end.x));
    const top = Math.max(bounds.top, Math.min(start.y, end.y));
    selection.style.left = `${left}px`;
    selection.style.top = `${top}px`;
    selection.style.width = `${Math.abs(end.x - start.x)}px`;
    selection.style.height = `${Math.abs(end.y - start.y)}px`;
    selection.hidden = false;
    return;
  }
  renderNormalizedSelection(rect, bounds);
}

function renderNormalizedSelection(rect: NormalizedRect, bounds: DOMRect): void {
  selection.style.left = `${bounds.left + rect.x * bounds.width}px`;
  selection.style.top = `${bounds.top + rect.y * bounds.height}px`;
  selection.style.width = `${rect.width * bounds.width}px`;
  selection.style.height = `${rect.height * bounds.height}px`;
  selection.hidden = false;
}

function isInside(x: number, y: number, bounds: DOMRect): boolean {
  return x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom;
}

function fail(message: string): void {
  status.textContent = message;
  status.classList.add("error");
  loading.hidden = true;
}

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element: ${id}`);
  return element as T;
}
