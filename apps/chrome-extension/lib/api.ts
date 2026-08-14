import {
  bookChatResponseSchema,
  bookChatThreadsResponseSchema,
  createChatThreadRequestSchema,
  bookSchema,
  chatTurnStreamEventSchema,
  codexStatusResponseSchema,
  createSourceAnchorRequestSchema,
  insightArtifactDetailSchema,
  insightListResponseSchema,
  insightVersionDiffResponseSchema,
  insightVersionHistoryResponseSchema,
  updateInsightRequestSchema,
  resolveSelectionResponseSchema,
  sourceAnchorSchema,
  type Book,
  type BookChatResponse,
  type BookChatThreadsResponse,
  type CreateChatThreadRequest,
  type ChatTurnStreamEvent,
  type CodexStatusResponse,
  type CreateSourceAnchorRequest,
  type InsightArtifactDetail,
  type InsightListResponse,
  type InsightVersionDiffResponse,
  type InsightVersionHistoryResponse,
  type UpdateInsightRequest,
  type ResolveSelectionResponse,
  type SourceAnchor,
} from "@deep-reader/shared";
import { getBookUrlCache, getServerBase, setBookUrlCache } from "./state";

const MAX_PDF_BYTES = 512 * 1024 * 1024;
const PDF_MAGIC = "%PDF-";

export async function apiJson<T>(path: string, init: RequestInit | undefined, parse: (value: unknown) => T): Promise<T> {
  const serverBase = await getServerBase();
  const response = await fetch(`${serverBase}${path}`, init);
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
      : `Deep Reader Server HTTP ${response.status}`;
    throw new Error(message);
  }
  return parse(body);
}

export async function fetchCodexStatus(signal?: AbortSignal): Promise<CodexStatusResponse> {
  return apiJson("/codex/status", signal ? { signal } : undefined, (value) => codexStatusResponseSchema.parse(value));
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
  if (!response.ok) throw new Error(`PDF取得に失敗しました: HTTP ${response.status}`);

  const declaredLength = Number.parseInt(response.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_PDF_BYTES) {
    throw new Error("PDFが512MBを超えているため取り込めません");
  }

  const blob = await response.blob();
  if (blob.size > MAX_PDF_BYTES) throw new Error("PDFが512MBを超えているため取り込めません");
  const magic = await blob.slice(0, PDF_MAGIC.length).text();
  if (magic !== PDF_MAGIC) {
    const contentType = response.headers.get("content-type") ?? "不明";
    throw new Error(`選択中のページをPDFとして取得できませんでした（Content-Type: ${contentType}）`);
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

export async function fetchBookChat(bookId: string, threadId?: string, signal?: AbortSignal): Promise<BookChatResponse> {
  const suffix = threadId ? `?threadId=${encodeURIComponent(threadId)}` : "";
  return apiJson(`/books/${encodeURIComponent(bookId)}/chat${suffix}`, signal ? { signal } : undefined, (value) => bookChatResponseSchema.parse(value));
}

export async function fetchBookChatThreads(bookId: string, signal?: AbortSignal): Promise<BookChatThreadsResponse> {
  return apiJson(`/books/${encodeURIComponent(bookId)}/chat/threads`, signal ? { signal } : undefined, (value) => bookChatThreadsResponseSchema.parse(value));
}

export async function createBookChatThread(bookId: string, input: CreateChatThreadRequest = {}): Promise<BookChatResponse> {
  const body = createChatThreadRequestSchema.parse(input);
  return apiJson(
    `/books/${encodeURIComponent(bookId)}/chat/threads`,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
    (value) => bookChatResponseSchema.parse(value),
  );
}

export async function streamChatTurn(
  input: { bookId: string; question: string; sourceIds: string[]; threadId?: string | null },
  onEvent: (event: ChatTurnStreamEvent) => void,
): Promise<void> {
  const serverBase = await getServerBase();
  const response = await fetch(`${serverBase}/books/${encodeURIComponent(input.bookId)}/chat/turns`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      question: input.question,
      sourceIds: input.sourceIds,
      ...(input.threadId ? { threadId: input.threadId } : {}),
    }),
  });
  if (!response.ok || !response.body) throw new Error(`Deep Dive HTTP ${response.status}`);

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
      onEvent(chatTurnStreamEventSchema.parse(JSON.parse(line)));
    }
    if (done) break;
  }
  if (buffer.trim()) onEvent(chatTurnStreamEventSchema.parse(JSON.parse(buffer)));
}

export async function fetchInsights(bookId: string, signal?: AbortSignal): Promise<InsightListResponse> {
  return apiJson(`/insights?bookId=${encodeURIComponent(bookId)}`, signal ? { signal } : undefined, (value) => insightListResponseSchema.parse(value));
}

export async function fetchInsightDetail(artifactId: string, signal?: AbortSignal): Promise<InsightArtifactDetail> {
  return apiJson(`/insights/${encodeURIComponent(artifactId)}`, signal ? { signal } : undefined, (value) => insightArtifactDetailSchema.parse(value));
}

export async function createInsightFromMessage(messageId: string): Promise<InsightArtifactDetail> {
  return apiJson(
    "/insights/from-message",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messageId }),
    },
    (value) => insightArtifactDetailSchema.parse(value),
  );
}

export async function updateInsight(artifactId: string, input: UpdateInsightRequest): Promise<InsightArtifactDetail> {
  const body = updateInsightRequestSchema.parse(input);
  return apiJson(
    `/insights/${encodeURIComponent(artifactId)}`,
    { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
    (value) => insightArtifactDetailSchema.parse(value),
  );
}

export async function fetchInsightVersions(artifactId: string, signal?: AbortSignal): Promise<InsightVersionHistoryResponse> {
  return apiJson(`/insights/${encodeURIComponent(artifactId)}/versions`, signal ? { signal } : undefined, (value) => insightVersionHistoryResponseSchema.parse(value));
}

export async function fetchInsightVersion(artifactId: string, version: number, signal?: AbortSignal): Promise<InsightArtifactDetail> {
  return apiJson(`/insights/${encodeURIComponent(artifactId)}/versions/${version}`, signal ? { signal } : undefined, (value) => insightArtifactDetailSchema.parse(value));
}

export async function fetchInsightDiff(artifactId: string, fromVersion: number, toVersion: number, signal?: AbortSignal): Promise<InsightVersionDiffResponse> {
  return apiJson(`/insights/${encodeURIComponent(artifactId)}/diff?from=${fromVersion}&to=${toVersion}`, signal ? { signal } : undefined, (value) => insightVersionDiffResponseSchema.parse(value));
}

function fileNameFromUrl(value: string): string {
  try {
    return decodeURIComponent(new URL(value).pathname.split("/").filter(Boolean).at(-1) ?? "book.pdf") || "book.pdf";
  } catch {
    return "book.pdf";
  }
}
