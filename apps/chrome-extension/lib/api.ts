import {
  addWorkspaceBookRequestSchema,
  addWorkspaceSourceRequestSchema,
  bookSchema,
  exploreTurnStreamEventSchema,
  codexStatusResponseSchema,
  codexUsageResponseSchema,
  createExploreThreadRequestSchema,
  createSourceAnchorRequestSchema,
  createVisualSourceRequestSchema,
  createWorkspaceRequestSchema,
  mapArtifactDetailSchema,
  mapListResponseSchema,
  mapVersionDiffResponseSchema,
  mapVersionHistoryResponseSchema,
  readerWorkspaceSchema,
  resolveSelectionResponseSchema,
  sourceAnchorSchema,
  updateMapRequestSchema,
  workspaceExploreResponseSchema,
  workspaceExploreThreadsResponseSchema,
  workspaceListResponseSchema,
  type Book,
  type ExploreTurnStreamEvent,
  type CodexStatusResponse,
  type CodexUsageResponse,
  type CreateExploreThreadRequest,
  type CreateSourceAnchorRequest,
  type CreateVisualSourceRequest,
  type CreateWorkspaceRequest,
  type MapArtifactDetail,
  type MapListResponse,
  type MapVersionDiffResponse,
  type MapVersionHistoryResponse,
  type ReaderWorkspace,
  type ResolveSelectionResponse,
  type SourceAnchor,
  type UpdateMapRequest,
  type WorkspaceExploreResponse,
  type WorkspaceExploreThreadsResponse,
  type WorkspaceListResponse,
} from "@lensmap/shared";
import { clearCapabilityToken, getBookUrlCache, getCapabilityToken, getServerBase, setBookUrlCache } from "./state";
import { requestServerStartup } from "./request-server-startup";
import { t } from "./i18n/runtime";

const MAX_PDF_BYTES = 512 * 1024 * 1024;
const PDF_MAGIC = "%PDF-";

export async function apiJson<T>(path: string, init: RequestInit | undefined, parse: (value: unknown) => T): Promise<T> {
  const response = await serverFetch(path, init);
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    const message = typeof body === "object" && body !== null && "message" in body
      ? String((body as { message: unknown }).message)
      : `Lensmap Server HTTP ${response.status}`;
    throw new Error(message);
  }
  return parse(body);
}

export async function fetchCodexStatus(signal?: AbortSignal): Promise<CodexStatusResponse> {
  return apiJson("/codex/status", signal ? { signal } : undefined, (value) => codexStatusResponseSchema.parse(value));
}

export async function fetchCodexUsage(threadId?: string | null, signal?: AbortSignal): Promise<CodexUsageResponse> {
  const suffix = threadId ? `?threadId=${encodeURIComponent(threadId)}` : "";
  return apiJson(`/codex/usage${suffix}`, signal ? { signal } : undefined, (value) => codexUsageResponseSchema.parse(value));
}

export async function fetchBooks(signal?: AbortSignal): Promise<Book[]> {
  return apiJson("/books", signal ? { signal } : undefined, (value) => bookSchema.array().parse(value));
}

/** Refetch, validate, import, and index a PDF while respecting cancellation from the extension capture lifecycle. */
export async function ensureBook(pdfUrl: string, signal?: AbortSignal): Promise<Book> {
  const cache = await getBookUrlCache();
  const existingId = cache[pdfUrl];
  if (existingId) {
    try {
      const books = await fetchBooks(signal);
      const existing = books.find((book) => book.id === existingId);
      if (existing) {
        await ensureIndexed(existing.id, signal);
        return existing;
      }
    } catch (error: unknown) {
      if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : error;
      // Re-import when the local server data directory has been reset.
    }
  }

  const response = await fetch(pdfUrl, {
    credentials: "include",
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw new Error(t("errors.pdfFetchFailed", { status: response.status }));

  const declaredLength = Number.parseInt(response.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_PDF_BYTES) {
    throw new Error(t("errors.pdfTooLarge"));
  }

  const blob = await response.blob();
  if (blob.size > MAX_PDF_BYTES) throw new Error(t("errors.pdfTooLarge"));
  const magic = await blob.slice(0, PDF_MAGIC.length).text();
  if (magic !== PDF_MAGIC) {
    const contentType = response.headers.get("content-type") ?? t("errors.unknownContentType");
    throw new Error(t("errors.notPdf", { contentType }));
  }

  const form = new FormData();
  form.append("file", blob, fileNameFromUrl(pdfUrl));
  const book = await apiJson(
    "/books/import",
    { method: "POST", body: form, ...(signal ? { signal } : {}) },
    (value) => bookSchema.parse(value),
  );
  await setBookUrlCache({ ...cache, [pdfUrl]: book.id });
  await ensureIndexed(book.id, signal);
  return book;
}

export async function ensureIndexed(bookId: string, signal?: AbortSignal): Promise<void> {
  await apiJson(
    `/books/${encodeURIComponent(bookId)}/document/index`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ force: false }),
      ...(signal ? { signal } : {}),
    },
    (value) => value,
  );
}

export async function resolveSelection(bookId: string, quoteRaw: string, signal?: AbortSignal): Promise<ResolveSelectionResponse> {
  return apiJson(
    `/books/${encodeURIComponent(bookId)}/sources/resolve`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ quoteRaw }),
      ...(signal ? { signal } : {}),
    },
    (value) => resolveSelectionResponseSchema.parse(value),
  );
}

export async function createSource(
  bookId: string,
  candidate: CreateSourceAnchorRequest,
  signal?: AbortSignal,
): Promise<SourceAnchor> {
  const input = createSourceAnchorRequestSchema.parse(candidate);
  return apiJson(
    `/books/${encodeURIComponent(bookId)}/sources`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      ...(signal ? { signal } : {}),
    },
    (value) => sourceAnchorSchema.parse(value),
  );
}

/** Upload a lossless crop as primary Visual Source evidence; OCR/location metadata may remain unresolved. */
export async function createVisualSource(
  bookId: string,
  metadata: CreateVisualSourceRequest,
  png: Blob,
  signal?: AbortSignal,
): Promise<SourceAnchor> {
  if (png.type !== "image/png") throw new Error("Visual Source crop must be PNG");
  const input = createVisualSourceRequestSchema.parse(metadata);
  const form = new FormData();
  form.append("metadata", JSON.stringify(input));
  form.append("file", png, "visual-source.png");
  return apiJson(
    `/books/${encodeURIComponent(bookId)}/sources/visual`,
    { method: "POST", body: form, ...(signal ? { signal } : {}) },
    (value) => sourceAnchorSchema.parse(value),
  );
}

/** Fetch a managed Visual Source PNG through the authenticated loopback API. */
export async function fetchVisualSourceAsset(bookId: string, assetId: string, signal?: AbortSignal): Promise<Blob> {
  const response = await serverFetch(
    `/books/${encodeURIComponent(bookId)}/sources/assets/${encodeURIComponent(assetId)}`,
    signal ? { signal } : undefined,
  );
  if (!response.ok) throw new Error(`Visual Source image HTTP ${response.status}`);
  const blob = await response.blob();
  if (blob.type !== "image/png") throw new Error("Visual Source asset is not a PNG");
  return blob;
}

export async function fetchWorkspaces(signal?: AbortSignal): Promise<WorkspaceListResponse> {
  return apiJson("/workspaces", signal ? { signal } : undefined, (value) => workspaceListResponseSchema.parse(value));
}

export async function fetchWorkspace(workspaceId: string, signal?: AbortSignal): Promise<ReaderWorkspace> {
  return apiJson(`/workspaces/${encodeURIComponent(workspaceId)}`, signal ? { signal } : undefined, (value) => readerWorkspaceSchema.parse(value));
}

export async function createWorkspace(input: CreateWorkspaceRequest = {}): Promise<ReaderWorkspace> {
  const body = createWorkspaceRequestSchema.parse(input);
  return apiJson("/workspaces", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, (value) => readerWorkspaceSchema.parse(value));
}

export async function addWorkspaceBook(workspaceId: string, bookId: string): Promise<ReaderWorkspace> {
  const body = addWorkspaceBookRequestSchema.parse({ bookId });
  return apiJson(`/workspaces/${encodeURIComponent(workspaceId)}/books`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, (value) => readerWorkspaceSchema.parse(value));
}

export async function addWorkspaceSource(workspaceId: string, sourceAnchorId: string): Promise<ReaderWorkspace> {
  const body = addWorkspaceSourceRequestSchema.parse({ sourceAnchorId });
  return apiJson(`/workspaces/${encodeURIComponent(workspaceId)}/sources`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, (value) => readerWorkspaceSchema.parse(value));
}

export async function removeWorkspaceSource(workspaceId: string, sourceAnchorId: string): Promise<ReaderWorkspace> {
  return apiJson(`/workspaces/${encodeURIComponent(workspaceId)}/sources/${encodeURIComponent(sourceAnchorId)}`, { method: "DELETE" }, (value) => readerWorkspaceSchema.parse(value));
}

export async function fetchWorkspaceExplore(workspaceId: string, threadId?: string, signal?: AbortSignal): Promise<WorkspaceExploreResponse> {
  const suffix = threadId ? `?threadId=${encodeURIComponent(threadId)}` : "";
  return apiJson(`/workspaces/${encodeURIComponent(workspaceId)}/explore${suffix}`, signal ? { signal } : undefined, (value) => workspaceExploreResponseSchema.parse(value));
}

export async function fetchWorkspaceExploreThreads(workspaceId: string, signal?: AbortSignal): Promise<WorkspaceExploreThreadsResponse> {
  return apiJson(`/workspaces/${encodeURIComponent(workspaceId)}/explore/threads`, signal ? { signal } : undefined, (value) => workspaceExploreThreadsResponseSchema.parse(value));
}

export async function createWorkspaceExploreThread(workspaceId: string, input: CreateExploreThreadRequest = {}): Promise<WorkspaceExploreResponse> {
  const body = createExploreThreadRequestSchema.parse(input);
  return apiJson(`/workspaces/${encodeURIComponent(workspaceId)}/explore/threads`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, (value) => workspaceExploreResponseSchema.parse(value));
}

export async function streamExploreTurn(
  input: { workspaceId: string; question: string; sourceIds: string[]; threadId?: string | null; model?: string | null },
  onEvent: (event: ExploreTurnStreamEvent) => void,
): Promise<void> {
  const response = await serverFetch(`/workspaces/${encodeURIComponent(input.workspaceId)}/explore/turns`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      question: input.question,
      sourceIds: input.sourceIds,
      ...(input.threadId ? { threadId: input.threadId } : {}),
      ...(input.model ? { model: input.model } : {}),
    }),
  });
  if (!response.ok || !response.body) throw new Error(`Explore HTTP ${response.status}`);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      onEvent(exploreTurnStreamEventSchema.parse(JSON.parse(line)));
    }
    if (done) break;
  }
  if (buffer.trim()) onEvent(exploreTurnStreamEventSchema.parse(JSON.parse(buffer)));
}

export async function fetchMaps(workspaceId: string, signal?: AbortSignal): Promise<MapListResponse> {
  return apiJson(`/maps?workspaceId=${encodeURIComponent(workspaceId)}`, signal ? { signal } : undefined, (value) => mapListResponseSchema.parse(value));
}

export async function fetchMapDetail(mapArtifactId: string, signal?: AbortSignal): Promise<MapArtifactDetail> {
  return apiJson(`/maps/${encodeURIComponent(mapArtifactId)}`, signal ? { signal } : undefined, (value) => mapArtifactDetailSchema.parse(value));
}

export async function updateMap(mapArtifactId: string, input: UpdateMapRequest): Promise<MapArtifactDetail> {
  const body = updateMapRequestSchema.parse(input);
  return apiJson(`/maps/${encodeURIComponent(mapArtifactId)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, (value) => mapArtifactDetailSchema.parse(value));
}

export async function fetchMapVersions(mapArtifactId: string, signal?: AbortSignal): Promise<MapVersionHistoryResponse> {
  return apiJson(`/maps/${encodeURIComponent(mapArtifactId)}/versions`, signal ? { signal } : undefined, (value) => mapVersionHistoryResponseSchema.parse(value));
}

export async function fetchMapVersion(mapArtifactId: string, version: number, signal?: AbortSignal): Promise<MapArtifactDetail> {
  return apiJson(`/maps/${encodeURIComponent(mapArtifactId)}/versions/${version}`, signal ? { signal } : undefined, (value) => mapArtifactDetailSchema.parse(value));
}

export async function fetchMapDiff(mapArtifactId: string, fromVersion: number, toVersion: number, signal?: AbortSignal): Promise<MapVersionDiffResponse> {
  return apiJson(`/maps/${encodeURIComponent(mapArtifactId)}/diff?from=${fromVersion}&to=${toVersion}`, signal ? { signal } : undefined, (value) => mapVersionDiffResponseSchema.parse(value));
}

/** Fetch the loopback API with the session-only capability, refreshing it once after a server restart. */
async function serverFetch(path: string, init: RequestInit | undefined): Promise<Response> {
  const serverBase = await getServerBase();
  const signal = init?.signal ?? undefined;
  let capabilityToken = await getCapabilityToken();
  if (!capabilityToken) {
    await requestServerStartup(signal);
    capabilityToken = await getCapabilityToken();
  }
  if (!capabilityToken) throw new Error(t("errors.capabilityUnavailable"));

  let response = await fetch(`${serverBase}${path}`, withCapability(init, capabilityToken));
  if (response.status !== 401) return response;

  // The server may have restarted and rotated its capability while Chrome remained open.
  await clearCapabilityToken();
  await requestServerStartup(signal);
  capabilityToken = await getCapabilityToken();
  if (!capabilityToken) return response;
  response = await fetch(`${serverBase}${path}`, withCapability(init, capabilityToken));
  return response;
}

function withCapability(init: RequestInit | undefined, capabilityToken: string): RequestInit {
  const headers = new Headers(init?.headers);
  headers.set("authorization", `Bearer ${capabilityToken}`);
  return { ...init, headers };
}

function fileNameFromUrl(value: string): string {
  try {
    return decodeURIComponent(new URL(value).pathname.split("/").filter(Boolean).at(-1) ?? "book.pdf") || "book.pdf";
  } catch {
    return "book.pdf";
  }
}
