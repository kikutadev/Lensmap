ALTER TABLE `source_anchors` ADD `printed_page_label_start` text;--> statement-breakpoint
ALTER TABLE `source_anchors` ADD `printed_page_label_end` text;--> statement-breakpoint
ALTER TABLE `source_anchors` ADD `document_node_ids_json` text DEFAULT '[]' NOT NULL;