CREATE VIRTUAL TABLE `document_blocks_trigram` USING fts5(
  `block_id` UNINDEXED,
  `book_id` UNINDEXED,
  `page_index` UNINDEXED,
  `text_normalized`,
  tokenize = 'trigram'
);
--> statement-breakpoint
INSERT INTO `document_blocks_trigram` (`block_id`, `book_id`, `page_index`, `text_normalized`)
SELECT `id`, `book_id`, `page_index`, `text_normalized` FROM `document_blocks`;
--> statement-breakpoint
UPDATE `artifact_blocks`
SET `grounding_status` = 'references-checked'
WHERE `grounding_status` = 'verified';
