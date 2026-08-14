CREATE TABLE `chat_retrieval_events` (
	`id` text PRIMARY KEY NOT NULL,
	`assistant_message_id` text NOT NULL,
	`tool_name` text NOT NULL,
	`arguments_json` text NOT NULL,
	`result_summary_json` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`assistant_message_id`) REFERENCES `chat_messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `chat_threads` ADD `context_tools_version` integer DEFAULT 0 NOT NULL;