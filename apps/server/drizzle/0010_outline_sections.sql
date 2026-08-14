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
CREATE INDEX `document_outline_book_order_idx` ON `document_outline_items` (`book_id`, `item_order`);
