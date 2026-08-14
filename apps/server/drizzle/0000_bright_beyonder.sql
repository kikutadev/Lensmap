CREATE TABLE `artifact_block_sources` (
	`block_id` text NOT NULL,
	`source_anchor_id` text NOT NULL,
	PRIMARY KEY(`block_id`, `source_anchor_id`),
	FOREIGN KEY (`block_id`) REFERENCES `artifact_blocks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_anchor_id`) REFERENCES `source_anchors`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `artifact_blocks` (
	`id` text PRIMARY KEY NOT NULL,
	`version_id` text NOT NULL,
	`kind` text NOT NULL,
	`block_order` integer NOT NULL,
	`content_json` text NOT NULL,
	`grounding_kind` text NOT NULL,
	`grounding_status` text NOT NULL,
	FOREIGN KEY (`version_id`) REFERENCES `artifact_versions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `artifact_sources` (
	`artifact_id` text NOT NULL,
	`source_anchor_id` text NOT NULL,
	PRIMARY KEY(`artifact_id`, `source_anchor_id`),
	FOREIGN KEY (`artifact_id`) REFERENCES `insight_artifacts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_anchor_id`) REFERENCES `source_anchors`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `artifact_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`artifact_id` text NOT NULL,
	`version` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`artifact_id`) REFERENCES `insight_artifacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `books` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`fingerprint` text NOT NULL,
	`file_name` text NOT NULL,
	`managed_path` text NOT NULL,
	`page_count` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `books_fingerprint_unique` ON `books` (`fingerprint`);--> statement-breakpoint
CREATE TABLE `insight_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`kind` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `source_anchors` (
	`id` text PRIMARY KEY NOT NULL,
	`book_id` text NOT NULL,
	`page_start` integer NOT NULL,
	`page_end` integer NOT NULL,
	`quote_raw` text NOT NULL,
	`quote_normalized` text NOT NULL,
	`prefix` text,
	`suffix` text,
	`rects_json` text NOT NULL,
	`text_hash` text NOT NULL,
	`origin` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade
);
