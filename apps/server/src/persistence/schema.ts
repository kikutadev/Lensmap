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


export const readerWorkspaces = sqliteTable("reader_workspaces", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const workspaceBooks = sqliteTable(
  "workspace_books",
  {
    workspaceId: text("workspace_id").notNull().references(() => readerWorkspaces.id, { onDelete: "cascade" }),
    bookId: text("book_id").notNull().references(() => books.id, { onDelete: "cascade" }),
    createdAt: text("created_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.bookId] })],
);

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
  kind: text("kind", { enum: ["text", "visual"] }).notNull().default("text"),
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
  imageAssetId: text("image_asset_id"),
  captureImageWidthPx: integer("capture_image_width_px"),
  captureImageHeightPx: integer("capture_image_height_px"),
  captureRectNormalizedJson: text("capture_rect_normalized_json"),
  locationStatus: text("location_status", { enum: ["unresolved", "page-resolved", "rect-resolved"] }),
  visualPage: integer("visual_page"),
  pageRectNormalizedJson: text("page_rect_normalized_json"),
  locationConfidence: integer("location_confidence_micros"),
  recognizedText: text("recognized_text"),
  ocrConfidence: integer("ocr_confidence_micros"),
  origin: text("origin", { enum: ["user-selection", "ai-expansion"] }).notNull(),
  documentNodeIdsJson: text("document_node_ids_json").notNull().default("[]"),
  createdAt: text("created_at").notNull(),
});

export const workspaceSources = sqliteTable(
  "workspace_sources",
  {
    workspaceId: text("workspace_id").notNull().references(() => readerWorkspaces.id, { onDelete: "cascade" }),
    sourceAnchorId: text("source_anchor_id").notNull().references(() => sourceAnchors.id, { onDelete: "cascade" }),
    sourceOrder: integer("source_order").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.sourceAnchorId] })],
);

export const exploreThreads = sqliteTable("explore_threads", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => readerWorkspaces.id, { onDelete: "cascade" }),
  originBookId: text("origin_book_id").notNull().references(() => books.id, { onDelete: "restrict" }),
  codexThreadId: text("codex_thread_id"),
  model: text("model").notNull(),
  contextToolsVersion: integer("context_tools_version").notNull().default(0),
  title: text("title").notNull().default("新しいExplore"),
  conversationSummary: text("conversation_summary").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const exploreMessages = sqliteTable("explore_messages", {
  id: text("id").primaryKey(),
  threadId: text("thread_id").notNull().references(() => exploreThreads.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["user", "assistant"] }).notNull(),
  content: text("content").notNull(),
  status: text("status", { enum: ["streaming", "completed", "error", "interrupted"] }).notNull(),
  codexTurnId: text("codex_turn_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const exploreMessageSources = sqliteTable(
  "explore_message_sources",
  {
    messageId: text("message_id").notNull().references(() => exploreMessages.id, { onDelete: "cascade" }),
    sourceAnchorId: text("source_anchor_id").notNull().references(() => sourceAnchors.id, { onDelete: "restrict" }),
    sourceLabel: text("source_label").notNull(),
    sourceOrder: integer("source_order").notNull(),
    includedText: text("included_text"),
    wasTruncated: integer("was_truncated", { mode: "boolean" }).notNull().default(false),
  },
  (table) => [primaryKey({ columns: [table.messageId, table.sourceAnchorId] })],
);


export const exploreRetrievalEvents = sqliteTable("explore_retrieval_events", {
  id: text("id").primaryKey(),
  assistantMessageId: text("assistant_message_id").notNull().references(() => exploreMessages.id, { onDelete: "cascade" }),
  toolName: text("tool_name").notNull(),
  argumentsJson: text("arguments_json").notNull(),
  resultSummaryJson: text("result_summary_json").notNull(),
  createdAt: text("created_at").notNull(),
});

export const mapArtifacts = sqliteTable("map_artifacts", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => readerWorkspaces.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  preview: text("preview").notNull().default(""),
  createdBy: text("created_by", { enum: ["ai", "user", "mixed"] }).notNull(),
  tagsJson: text("tags_json").notNull().default("[]"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const mapVersions = sqliteTable("map_versions", {
  id: text("id").primaryKey(),
  mapArtifactId: text("map_artifact_id").notNull().references(() => mapArtifacts.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  title: text("title"),
  conciseExplanation: text("concise_explanation").notNull().default(""),
  createdAt: text("created_at").notNull(),
});

export const mapBlocks = sqliteTable("map_blocks", {
  id: text("id").primaryKey(),
  versionId: text("version_id").notNull().references(() => mapVersions.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["narrative", "callout", "table", "diagram", "chart", "visual-reference"] }).notNull(),
  blockOrder: integer("block_order").notNull(),
  contentJson: text("content_json").notNull(),
  groundingKind: text("grounding_kind", { enum: ["source-backed", "derived", "ai-explanation"] }).notNull(),
  groundingStatus: text("grounding_status", { enum: ["references-checked", "claim-verified", "modified", "needs-review"] }).notNull(),
});

export const mapSources = sqliteTable(
  "map_sources",
  {
    mapArtifactId: text("map_artifact_id").notNull().references(() => mapArtifacts.id, { onDelete: "cascade" }),
    sourceAnchorId: text("source_anchor_id").notNull().references(() => sourceAnchors.id, { onDelete: "restrict" }),
  },
  (table) => [primaryKey({ columns: [table.mapArtifactId, table.sourceAnchorId] })],
);

export const mapOriginTurns = sqliteTable(
  "map_origin_turns",
  {
    mapArtifactId: text("map_artifact_id").notNull().references(() => mapArtifacts.id, { onDelete: "cascade" }),
    codexTurnId: text("codex_turn_id").notNull(),
  },
  (table) => [primaryKey({ columns: [table.mapArtifactId, table.codexTurnId] })],
);

export const mapBlockSources = sqliteTable(
  "map_block_sources",
  {
    blockId: text("block_id").notNull().references(() => mapBlocks.id, { onDelete: "cascade" }),
    sourceAnchorId: text("source_anchor_id").notNull().references(() => sourceAnchors.id, { onDelete: "restrict" }),
    sourceLabel: text("source_label").notNull(),
  },
  (table) => [primaryKey({ columns: [table.blockId, table.sourceAnchorId] })],
);
