CREATE TABLE `books` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`fingerprint` text NOT NULL,
	`file_name` text NOT NULL,
	`managed_path` text NOT NULL,
	`page_count` integer,
	`indexed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `books_fingerprint_unique` ON `books` (`fingerprint`);--> statement-breakpoint
CREATE TABLE `document_blocks` (
	`id` text PRIMARY KEY NOT NULL,
	`book_id` text NOT NULL,
	`page_index` integer NOT NULL,
	`block_order` integer NOT NULL,
	`kind` text NOT NULL,
	`text_raw` text NOT NULL,
	`text_normalized` text NOT NULL,
	`rects_json` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `document_outline_items` (
	`id` text PRIMARY KEY NOT NULL,
	`book_id` text NOT NULL,
	`item_order` integer NOT NULL,
	`title` text NOT NULL,
	`page_index` integer NOT NULL,
	`depth` integer NOT NULL,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `document_pages` (
	`id` text PRIMARY KEY NOT NULL,
	`book_id` text NOT NULL,
	`page_index` integer NOT NULL,
	`printed_page_label` text,
	`text_raw` text NOT NULL,
	`text_normalized` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `explore_message_sources` (
	`message_id` text NOT NULL,
	`source_anchor_id` text NOT NULL,
	`source_label` text NOT NULL,
	`source_order` integer NOT NULL,
	`included_text` text,
	`was_truncated` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`message_id`, `source_anchor_id`),
	FOREIGN KEY (`message_id`) REFERENCES `explore_messages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_anchor_id`) REFERENCES `source_anchors`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `explore_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`status` text NOT NULL,
	`codex_turn_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `explore_threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `explore_retrieval_events` (
	`id` text PRIMARY KEY NOT NULL,
	`assistant_message_id` text NOT NULL,
	`tool_name` text NOT NULL,
	`arguments_json` text NOT NULL,
	`result_summary_json` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`assistant_message_id`) REFERENCES `explore_messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `explore_threads` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`origin_book_id` text NOT NULL,
	`codex_thread_id` text,
	`model` text NOT NULL,
	`context_tools_version` integer DEFAULT 0 NOT NULL,
	`title` text DEFAULT '新しいExplore' NOT NULL,
	`conversation_summary` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `reader_workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`origin_book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `map_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`title` text NOT NULL,
	`preview` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`tags_json` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `reader_workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `map_block_sources` (
	`block_id` text NOT NULL,
	`source_anchor_id` text NOT NULL,
	`source_label` text NOT NULL,
	PRIMARY KEY(`block_id`, `source_anchor_id`),
	FOREIGN KEY (`block_id`) REFERENCES `map_blocks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_anchor_id`) REFERENCES `source_anchors`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `map_blocks` (
	`id` text PRIMARY KEY NOT NULL,
	`version_id` text NOT NULL,
	`kind` text NOT NULL,
	`block_order` integer NOT NULL,
	`content_json` text NOT NULL,
	`grounding_kind` text NOT NULL,
	`grounding_status` text NOT NULL,
	FOREIGN KEY (`version_id`) REFERENCES `map_versions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `map_origin_turns` (
	`map_artifact_id` text NOT NULL,
	`codex_turn_id` text NOT NULL,
	PRIMARY KEY(`map_artifact_id`, `codex_turn_id`),
	FOREIGN KEY (`map_artifact_id`) REFERENCES `map_artifacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `map_sources` (
	`map_artifact_id` text NOT NULL,
	`source_anchor_id` text NOT NULL,
	PRIMARY KEY(`map_artifact_id`, `source_anchor_id`),
	FOREIGN KEY (`map_artifact_id`) REFERENCES `map_artifacts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_anchor_id`) REFERENCES `source_anchors`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `map_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`map_artifact_id` text NOT NULL,
	`version` integer NOT NULL,
	`title` text,
	`concise_explanation` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`map_artifact_id`) REFERENCES `map_artifacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `reader_workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `source_anchors` (
	`id` text PRIMARY KEY NOT NULL,
	`book_id` text NOT NULL,
	`kind` text DEFAULT 'text' NOT NULL,
	`page_start` integer NOT NULL,
	`page_end` integer NOT NULL,
	`printed_page_label_start` text,
	`printed_page_label_end` text,
	`quote_raw` text NOT NULL,
	`quote_normalized` text NOT NULL,
	`prefix` text,
	`suffix` text,
	`rects_json` text NOT NULL,
	`text_hash` text NOT NULL,
	`image_asset_id` text,
	`capture_image_width_px` integer,
	`capture_image_height_px` integer,
	`capture_rect_normalized_json` text,
	`location_status` text,
	`visual_page` integer,
	`page_rect_normalized_json` text,
	`location_confidence_micros` integer,
	`recognized_text` text,
	`ocr_confidence_micros` integer,
	`origin` text NOT NULL,
	`document_node_ids_json` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `workspace_books` (
	`workspace_id` text NOT NULL,
	`book_id` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `book_id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `reader_workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `workspace_sources` (
	`workspace_id` text NOT NULL,
	`source_anchor_id` text NOT NULL,
	`source_order` integer NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `source_anchor_id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `reader_workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_anchor_id`) REFERENCES `source_anchors`(`id`) ON UPDATE no action ON DELETE cascade
);

--> statement-breakpoint
CREATE INDEX `document_pages_book_page_idx` ON `document_pages` (`book_id`, `page_index`);
--> statement-breakpoint
CREATE INDEX `document_blocks_book_page_order_idx` ON `document_blocks` (`book_id`, `page_index`, `block_order`);
--> statement-breakpoint
CREATE VIRTUAL TABLE `document_blocks_fts` USING fts5(
  `block_id` UNINDEXED,
  `book_id` UNINDEXED,
  `page_index` UNINDEXED,
  `text_normalized`,
  tokenize = 'unicode61 remove_diacritics 2'
);
--> statement-breakpoint
CREATE VIRTUAL TABLE `document_blocks_trigram` USING fts5(
  `block_id` UNINDEXED,
  `book_id` UNINDEXED,
  `page_index` UNINDEXED,
  `text_normalized`,
  tokenize = 'trigram'
);
