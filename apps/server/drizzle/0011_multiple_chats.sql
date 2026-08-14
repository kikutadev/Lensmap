ALTER TABLE `chat_threads` ADD `title` text NOT NULL DEFAULT 'Deep Dive';
--> statement-breakpoint
ALTER TABLE `chat_threads` ADD `conversation_summary` text NOT NULL DEFAULT '';
