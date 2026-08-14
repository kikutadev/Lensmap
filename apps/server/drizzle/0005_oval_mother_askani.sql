ALTER TABLE `chat_message_sources` ADD `included_text` text;--> statement-breakpoint
ALTER TABLE `chat_message_sources` ADD `was_truncated` integer DEFAULT false NOT NULL;