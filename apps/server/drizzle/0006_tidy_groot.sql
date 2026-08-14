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
ALTER TABLE `books` ADD `indexed_at` text;
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
