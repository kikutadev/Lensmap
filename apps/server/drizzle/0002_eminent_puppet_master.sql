CREATE TABLE `chat_message_sources` (
	`message_id` text NOT NULL,
	`source_anchor_id` text NOT NULL,
	`source_label` text NOT NULL,
	`source_order` integer NOT NULL,
	PRIMARY KEY(`message_id`, `source_anchor_id`),
	FOREIGN KEY (`message_id`) REFERENCES `chat_messages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_anchor_id`) REFERENCES `source_anchors`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `chat_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`status` text NOT NULL,
	`codex_turn_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `chat_threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `chat_threads` (
	`id` text PRIMARY KEY NOT NULL,
	`book_id` text NOT NULL,
	`codex_thread_id` text,
	`model` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade
);
