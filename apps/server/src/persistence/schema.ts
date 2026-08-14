import { integer, sqliteTable, text, primaryKey } from "drizzle-orm/sqlite-core";

export const books = sqliteTable("books", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  fingerprint: text("fingerprint").notNull().unique(),
  fileName: text("file_name").notNull(),
  managedPath: text("managed_path").notNull(),
  pageCount: integer("page_count"),
  indexedAt: text("indexed_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});


export const documentPages = sqliteTable("document_pages", {
  id: text("id").primaryKey(),
  bookId: text("book_id").notNull().references(() => books.id, { onDelete: "cascade" }),
  pageIndex: integer("page_index").notNull(),
  printedPageLabel: text("printed_page_label"),
  textRaw: text("text_raw").notNull(),
  textNormalized: text("text_normalized").notNull(),
  createdAt: text("created_at").notNull(),
});

export const documentBlocks = sqliteTable("document_blocks", {
  id: text("id").primaryKey(),
  bookId: text("book_id").notNull().references(() => books.id, { onDelete: "cascade" }),
  pageIndex: integer("page_index").notNull(),
  blockOrder: integer("block_order").notNull(),
  kind: text("kind", { enum: ["heading", "paragraph", "code", "table-like"] }).notNull(),
  textRaw: text("text_raw").notNull(),
  textNormalized: text("text_normalized").notNull(),
  rectsJson: text("rects_json").notNull().default("[]"),
  createdAt: text("created_at").notNull(),
});

export const documentOutlineItems = sqliteTable("document_outline_items", {
  id: text("id").primaryKey(),
  bookId: text("book_id").notNull().references(() => books.id, { onDelete: "cascade" }),
  itemOrder: integer("item_order").notNull(),
  title: text("title").notNull(),
  pageIndex: integer("page_index").notNull(),
  depth: integer("depth").notNull(),
});

export const sourceAnchors = sqliteTable("source_anchors", {
  id: text("id").primaryKey(),
  bookId: text("book_id").notNull().references(() => books.id, { onDelete: "cascade" }),
  pageStart: integer("page_start").notNull(),
  pageEnd: integer("page_end").notNull(),
  printedPageLabelStart: text("printed_page_label_start"),
  printedPageLabelEnd: text("printed_page_label_end"),
  quoteRaw: text("quote_raw").notNull(),
  quoteNormalized: text("quote_normalized").notNull(),
  prefix: text("prefix"),
  suffix: text("suffix"),
  rectsJson: text("rects_json").notNull(),
  textHash: text("text_hash").notNull(),
  origin: text("origin", { enum: ["user-selection", "ai-expansion"] }).notNull(),
  documentNodeIdsJson: text("document_node_ids_json").notNull().default("[]"),
  createdAt: text("created_at").notNull(),
});

export const chatThreads = sqliteTable("chat_threads", {
  id: text("id").primaryKey(),
  bookId: text("book_id").notNull().references(() => books.id, { onDelete: "cascade" }),
  codexThreadId: text("codex_thread_id"),
  model: text("model").notNull(),
  contextToolsVersion: integer("context_tools_version").notNull().default(0),
  title: text("title").notNull().default("Deep Dive"),
  conversationSummary: text("conversation_summary").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const chatMessages = sqliteTable("chat_messages", {
  id: text("id").primaryKey(),
  threadId: text("thread_id").notNull().references(() => chatThreads.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["user", "assistant"] }).notNull(),
  content: text("content").notNull(),
  status: text("status", { enum: ["streaming", "completed", "error", "interrupted"] }).notNull(),
  codexTurnId: text("codex_turn_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const chatMessageSources = sqliteTable(
  "chat_message_sources",
  {
    messageId: text("message_id").notNull().references(() => chatMessages.id, { onDelete: "cascade" }),
    sourceAnchorId: text("source_anchor_id").notNull().references(() => sourceAnchors.id, { onDelete: "restrict" }),
    sourceLabel: text("source_label").notNull(),
    sourceOrder: integer("source_order").notNull(),
    includedText: text("included_text"),
    wasTruncated: integer("was_truncated", { mode: "boolean" }).notNull().default(false),
  },
  (table) => [primaryKey({ columns: [table.messageId, table.sourceAnchorId] })],
);


export const chatRetrievalEvents = sqliteTable("chat_retrieval_events", {
  id: text("id").primaryKey(),
  assistantMessageId: text("assistant_message_id").notNull().references(() => chatMessages.id, { onDelete: "cascade" }),
  toolName: text("tool_name").notNull(),
  argumentsJson: text("arguments_json").notNull(),
  resultSummaryJson: text("result_summary_json").notNull(),
  createdAt: text("created_at").notNull(),
});

export const insightArtifacts = sqliteTable("insight_artifacts", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  kind: text("kind", { enum: ["note", "report", "table", "diagram", "chart"] }).notNull(),
  primaryBookId: text("primary_book_id").references(() => books.id, { onDelete: "set null" }),
  createdBy: text("created_by", { enum: ["ai", "user", "mixed"] }).notNull(),
  tagsJson: text("tags_json").notNull().default("[]"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const artifactVersions = sqliteTable("artifact_versions", {
  id: text("id").primaryKey(),
  artifactId: text("artifact_id").notNull().references(() => insightArtifacts.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  title: text("title"),
  createdAt: text("created_at").notNull(),
});

export const artifactBlocks = sqliteTable("artifact_blocks", {
  id: text("id").primaryKey(),
  versionId: text("version_id").notNull().references(() => artifactVersions.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["markdown", "table", "diagram", "chart"] }).notNull(),
  blockOrder: integer("block_order").notNull(),
  contentJson: text("content_json").notNull(),
  groundingKind: text("grounding_kind", { enum: ["source-backed", "derived", "ai-explanation"] }).notNull(),
  groundingStatus: text("grounding_status", { enum: ["references-checked", "claim-verified", "modified", "needs-review"] }).notNull(),
});

export const artifactSources = sqliteTable(
  "artifact_sources",
  {
    artifactId: text("artifact_id").notNull().references(() => insightArtifacts.id, { onDelete: "cascade" }),
    sourceAnchorId: text("source_anchor_id").notNull().references(() => sourceAnchors.id, { onDelete: "restrict" }),
  },
  (table) => [primaryKey({ columns: [table.artifactId, table.sourceAnchorId] })],
);


export const artifactOriginTurns = sqliteTable(
  "artifact_origin_turns",
  {
    artifactId: text("artifact_id").notNull().references(() => insightArtifacts.id, { onDelete: "cascade" }),
    codexTurnId: text("codex_turn_id").notNull(),
  },
  (table) => [primaryKey({ columns: [table.artifactId, table.codexTurnId] })],
);

export const artifactBlockSources = sqliteTable(
  "artifact_block_sources",
  {
    blockId: text("block_id").notNull().references(() => artifactBlocks.id, { onDelete: "cascade" }),
    sourceAnchorId: text("source_anchor_id").notNull().references(() => sourceAnchors.id, { onDelete: "restrict" }),
    sourceLabel: text("source_label").notNull(),
  },
  (table) => [primaryKey({ columns: [table.blockId, table.sourceAnchorId] })],
);
