import {
  bookChatResponseSchema,
  bookChatThreadsResponseSchema,
  createChatThreadRequestSchema,
  bookSchema,
  bookSearchResponseSchema,
  chatTurnStreamEventSchema,
  createSourceAnchorRequestSchema,
  codexLoginResponseSchema,
  codexStatusResponseSchema,
  createInsightFromMessageRequestSchema,
  documentIndexStatusSchema,
  documentOutlineResponseSchema,
  healthResponseSchema,
  insightArtifactDetailSchema,
  insightListResponseSchema,
  insightVersionDiffResponseSchema,
  insightVersionHistoryResponseSchema,
  updateInsightRequestSchema,
  sourceAnchorSchema,
  startChatTurnRequestSchema,
  type Book,
  type BookSearchResponse,
  type BookChatResponse,
  type BookChatThreadsResponse,
  type CreateChatThreadRequest,
  type ChatTurnStreamEvent,
  type CreateSourceAnchorRequest,
  type CodexLoginResponse,
  type CodexStatusResponse,
  type CreateInsightFromMessageRequest,
  type DocumentIndexStatus,
  type DocumentOutlineResponse,
  type HealthResponse,
  type InsightArtifactDetail,
  type InsightListResponse,
  type InsightVersionDiffResponse,
  type InsightVersionHistoryResponse,
  type UpdateInsightRequest,
  type SourceAnchor,
  type StartChatTurnRequest,
} from "@deep-reader/shared";
import { z } from "zod";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:4317";

/** Fetch and validate the local server health response at the network boundary. */
export async function fetchHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const response = await fetch(
    `${apiBaseUrl}/api/health`,
    signal ? { signal } : undefined,
  );
  if (!response.ok) {
    throw new Error(`Health check failed with status ${response.status}`);
  }

  return healthResponseSchema.parse(await response.json());
}

/** Return the locally managed book library. */
export async function fetchBooks(signal?: AbortSignal): Promise<Book[]> {
  const response = await fetch(
    `${apiBaseUrl}/api/books`,
    signal ? { signal } : undefined,
  );
  if (!response.ok) {
    throw new Error(`Book list failed with status ${response.status}`);
  }

  return z.array(bookSchema).parse(await response.json());
}

/** Upload one PDF into the application's managed library and validate the returned book. */
export async function importBook(file: File): Promise<Book> {
  const form = new FormData();
  form.append("file", file, file.name);
  const response = await fetch(`${apiBaseUrl}/api/books/import`, {
    method: "POST",
    body: form,
  });

  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    const message = z.object({ message: z.string() }).safeParse(payload);
    throw new Error(message.success ? message.data.message : `Import failed with status ${response.status}`);
  }

  return bookSchema.parse(await response.json());
}

/** Build the stable local URL used by PDF.js to load a managed book. */
export function getBookPdfUrl(bookId: string): string {
  return `${apiBaseUrl}/api/books/${encodeURIComponent(bookId)}/pdf`;
}

/** Persist a user-selected PDF range as an immutable SourceAnchor. */
export async function createSourceAnchor(
  bookId: string,
  input: CreateSourceAnchorRequest,
): Promise<SourceAnchor> {
  const body = createSourceAnchorRequestSchema.parse(input);
  const response = await fetch(
    `${apiBaseUrl}/api/books/${encodeURIComponent(bookId)}/sources`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );

  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    const message = z.object({ message: z.string() }).safeParse(payload);
    throw new Error(
      message.success ? message.data.message : `Source creation failed with status ${response.status}`,
    );
  }

  return sourceAnchorSchema.parse(await response.json());
}

/** Load saved anchors for a book; useful for restoring selections and audit history. */
export async function fetchSourceAnchors(
  bookId: string,
  signal?: AbortSignal,
): Promise<SourceAnchor[]> {
  const response = await fetch(
    `${apiBaseUrl}/api/books/${encodeURIComponent(bookId)}/sources`,
    signal ? { signal } : undefined,
  );
  if (!response.ok) {
    throw new Error(`Source list failed with status ${response.status}`);
  }
  return z.array(sourceAnchorSchema).parse(await response.json());
}

/** Read Codex app-server availability, ChatGPT account state, and the current model catalog. */
export async function fetchCodexStatus(signal?: AbortSignal): Promise<CodexStatusResponse> {
  const response = await fetch(
    `${apiBaseUrl}/api/codex/status`,
    signal ? { signal } : undefined,
  );
  if (!response.ok) {
    throw new Error(`Codex status failed with status ${response.status}`);
  }
  return codexStatusResponseSchema.parse(await response.json());
}

/** Start the Codex-managed ChatGPT OAuth flow without storing an API key in Deep Reader. */
export async function startCodexChatGptLogin(): Promise<CodexLoginResponse> {
  const response = await fetch(`${apiBaseUrl}/api/codex/login/chatgpt`, { method: "POST" });
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    const message = z.object({ message: z.string() }).safeParse(payload);
    throw new Error(message.success ? message.data.message : `Codex login failed with status ${response.status}`);
  }
  return codexLoginResponseSchema.parse(await response.json());
}

/** Load the latest persisted Deep Dive thread for a book. */
export async function fetchBookChat(bookId: string, threadId?: string, signal?: AbortSignal): Promise<BookChatResponse> {
  const query = threadId ? `?threadId=${encodeURIComponent(threadId)}` : "";
  const response = await fetch(
    `${apiBaseUrl}/api/books/${encodeURIComponent(bookId)}/chat${query}`,
    signal ? { signal } : undefined,
  );
  if (!response.ok) {
    throw new Error(`Chat load failed with status ${response.status}`);
  }
  return bookChatResponseSchema.parse(await response.json());
}

/** List saved Deep Dive chats for one book, newest first. */
export async function fetchBookChatThreads(bookId: string, signal?: AbortSignal): Promise<BookChatThreadsResponse> {
  const response = await fetch(`${apiBaseUrl}/api/books/${encodeURIComponent(bookId)}/chat/threads`, signal ? { signal } : undefined);
  if (!response.ok) throw new Error(`Chat threads failed with status ${response.status}`);
  return bookChatThreadsResponseSchema.parse(await response.json());
}

/** Create a separate local Deep Dive chat; Codex thread allocation remains lazy until first question. */
export async function createBookChatThread(bookId: string, input: CreateChatThreadRequest = {}): Promise<BookChatResponse> {
  const body = createChatThreadRequestSchema.parse(input);
  const response = await fetch(`${apiBaseUrl}/api/books/${encodeURIComponent(bookId)}/chat/threads`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Chat thread creation failed with status ${response.status}`);
  return bookChatResponseSchema.parse(await response.json());
}

/**
 * Send one grounded Deep Dive turn and parse newline-delimited stream events.
 * POST+fetch is used instead of EventSource so the selected Source IDs remain in one request.
 */
export async function streamChatTurn(
  bookId: string,
  input: StartChatTurnRequest,
  onEvent: (event: ChatTurnStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const body = startChatTurnRequestSchema.parse(input);
  const response = await fetch(`${apiBaseUrl}/api/books/${encodeURIComponent(bookId)}/chat/turns`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  });

  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    const message = z.object({ message: z.string() }).safeParse(payload);
    throw new Error(message.success ? message.data.message : `Chat turn failed with status ${response.status}`);
  }
  if (!response.body) {
    throw new Error("Chat stream was not returned by the server");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      onEvent(chatTurnStreamEventSchema.parse(JSON.parse(trimmed)));
    }
    if (done) break;
  }

  const trailing = buffer.trim();
  if (trailing) {
    onEvent(chatTurnStreamEventSchema.parse(JSON.parse(trailing)));
  }
}

/** Interrupt the active Deep Dive turn for the current book. */
export async function interruptChatTurn(bookId: string): Promise<boolean> {
  const response = await fetch(`${apiBaseUrl}/api/books/${encodeURIComponent(bookId)}/chat/interrupt`, {
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(`Chat interrupt failed with status ${response.status}`);
  }
  return z.object({ interrupted: z.boolean() }).parse(await response.json()).interrupted;
}


/** List durable Insights associated with the active book. */
export async function fetchInsights(bookId: string, signal?: AbortSignal): Promise<InsightListResponse> {
  const response = await fetch(
    `${apiBaseUrl}/api/insights?bookId=${encodeURIComponent(bookId)}`,
    signal ? { signal } : undefined,
  );
  if (!response.ok) {
    throw new Error(`Insight list failed with status ${response.status}`);
  }
  return insightListResponseSchema.parse(await response.json());
}

/** Load one Insight with block-level provenance and source metadata. */
export async function fetchInsightDetail(artifactId: string, signal?: AbortSignal): Promise<InsightArtifactDetail> {
  const response = await fetch(
    `${apiBaseUrl}/api/insights/${encodeURIComponent(artifactId)}`,
    signal ? { signal } : undefined,
  );
  if (!response.ok) {
    throw new Error(`Insight read failed with status ${response.status}`);
  }
  return insightArtifactDetailSchema.parse(await response.json());
}

/** Save a completed assistant message as a versioned Report Insight. */
export async function createInsightFromMessage(
  input: CreateInsightFromMessageRequest,
): Promise<InsightArtifactDetail> {
  const body = createInsightFromMessageRequestSchema.parse(input);
  const response = await fetch(`${apiBaseUrl}/api/insights/from-message`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    const message = z.object({ message: z.string() }).safeParse(payload);
    throw new Error(message.success ? message.data.message : `Insight creation failed with status ${response.status}`);
  }
  return insightArtifactDetailSchema.parse(await response.json());
}


/** Start or await local PDF text indexing for structured retrieval. */
export async function startBookIndex(bookId: string, force = false): Promise<DocumentIndexStatus> {
  const response = await fetch(
    `${apiBaseUrl}/api/books/${encodeURIComponent(bookId)}/document/index`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ force }),
    },
  );
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    const message = z.object({ message: z.string() }).safeParse(payload);
    throw new Error(message.success ? message.data.message : `Book indexing failed with status ${response.status}`);
  }
  return documentIndexStatusSchema.parse(await response.json());
}

/** Read structured-index readiness without triggering work. */
export async function fetchBookIndexStatus(bookId: string, signal?: AbortSignal): Promise<DocumentIndexStatus> {
  const response = await fetch(
    `${apiBaseUrl}/api/books/${encodeURIComponent(bookId)}/document/index/status`,
    signal ? { signal } : undefined,
  );
  if (!response.ok) throw new Error(`Index status failed with status ${response.status}`);
  return documentIndexStatusSchema.parse(await response.json());
}

/** Search the current book's local FTS5 index; no AI or external service is involved. */
export async function searchBook(
  bookId: string,
  query: string,
  signal?: AbortSignal,
): Promise<BookSearchResponse> {
  const url = `${apiBaseUrl}/api/books/${encodeURIComponent(bookId)}/document/search?q=${encodeURIComponent(query)}&limit=20`;
  const response = await fetch(url, signal ? { signal } : undefined);
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    const message = z.object({ message: z.string() }).safeParse(payload);
    throw new Error(message.success ? message.data.message : `Book search failed with status ${response.status}`);
  }
  return bookSearchResponseSchema.parse(await response.json());
}


/** Load a conservative heading outline derived from the local document index. */
export async function fetchBookOutline(bookId: string, signal?: AbortSignal): Promise<DocumentOutlineResponse> {
  const response = await fetch(
    `${apiBaseUrl}/api/books/${encodeURIComponent(bookId)}/document/outline`,
    signal ? { signal } : undefined,
  );
  if (!response.ok) throw new Error(`Book outline failed with status ${response.status}`);
  return documentOutlineResponseSchema.parse(await response.json());
}


/** Create a new immutable Insight version from user edits. */
export async function updateInsight(artifactId: string, input: UpdateInsightRequest): Promise<InsightArtifactDetail> {
  const body = updateInsightRequestSchema.parse(input);
  const response = await fetch(`${apiBaseUrl}/api/insights/${encodeURIComponent(artifactId)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Insight update failed with status ${response.status}`);
  return insightArtifactDetailSchema.parse(await response.json());
}

export async function fetchInsightVersions(artifactId: string, signal?: AbortSignal): Promise<InsightVersionHistoryResponse> {
  const response = await fetch(`${apiBaseUrl}/api/insights/${encodeURIComponent(artifactId)}/versions`, signal ? { signal } : undefined);
  if (!response.ok) throw new Error(`Insight versions failed with status ${response.status}`);
  return insightVersionHistoryResponseSchema.parse(await response.json());
}

export async function fetchInsightVersion(artifactId: string, version: number, signal?: AbortSignal): Promise<InsightArtifactDetail> {
  const response = await fetch(`${apiBaseUrl}/api/insights/${encodeURIComponent(artifactId)}/versions/${version}`, signal ? { signal } : undefined);
  if (!response.ok) throw new Error(`Insight version failed with status ${response.status}`);
  return insightArtifactDetailSchema.parse(await response.json());
}

export async function fetchInsightDiff(artifactId: string, fromVersion: number, toVersion: number, signal?: AbortSignal): Promise<InsightVersionDiffResponse> {
  const response = await fetch(`${apiBaseUrl}/api/insights/${encodeURIComponent(artifactId)}/diff?from=${fromVersion}&to=${toVersion}`, signal ? { signal } : undefined);
  if (!response.ok) throw new Error(`Insight diff failed with status ${response.status}`);
  return insightVersionDiffResponseSchema.parse(await response.json());
}
