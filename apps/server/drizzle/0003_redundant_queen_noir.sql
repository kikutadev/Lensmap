CREATE TABLE `artifact_origin_turns` (
	`artifact_id` text NOT NULL,
	`codex_turn_id` text NOT NULL,
	PRIMARY KEY(`artifact_id`, `codex_turn_id`),
	FOREIGN KEY (`artifact_id`) REFERENCES `insight_artifacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `insight_artifacts` ADD `primary_book_id` text REFERENCES books(id);