ALTER TABLE `map_versions` ADD `semantic_kind` text DEFAULT 'synthesis' NOT NULL;--> statement-breakpoint
ALTER TABLE `map_versions` ADD `primary_block_id` text;
--> statement-breakpoint
UPDATE `map_versions`
SET `semantic_kind` = CASE
  WHEN EXISTS (SELECT 1 FROM `map_blocks` b WHERE b.`version_id` = `map_versions`.`id` AND b.`kind` = 'chart') THEN 'quantitative'
  WHEN EXISTS (SELECT 1 FROM `map_blocks` b WHERE b.`version_id` = `map_versions`.`id` AND b.`kind` = 'table') THEN 'comparison'
  WHEN EXISTS (SELECT 1 FROM `map_blocks` b WHERE b.`version_id` = `map_versions`.`id` AND json_extract(b.`content_json`, '$.visualization.type') = 'hierarchy') THEN 'hierarchy'
  WHEN EXISTS (SELECT 1 FROM `map_blocks` b WHERE b.`version_id` = `map_versions`.`id` AND json_extract(b.`content_json`, '$.visualization.type') = 'timeline') THEN 'timeline'
  WHEN EXISTS (SELECT 1 FROM `map_blocks` b WHERE b.`version_id` = `map_versions`.`id` AND json_extract(b.`content_json`, '$.visualization.type') = 'flow') THEN 'process'
  WHEN EXISTS (SELECT 1 FROM `map_blocks` b WHERE b.`version_id` = `map_versions`.`id` AND json_extract(b.`content_json`, '$.visualization.type') = 'callout' AND json_extract(b.`content_json`, '$.visualization.tone') = 'definition') THEN 'definition'
  ELSE 'synthesis'
END;
--> statement-breakpoint
UPDATE `map_versions`
SET `primary_block_id` = (
  SELECT b.`id`
  FROM `map_blocks` b
  WHERE b.`version_id` = `map_versions`.`id`
  ORDER BY CASE WHEN b.`kind` IN ('table', 'chart', 'diagram') THEN 0 ELSE 1 END, b.`block_order`
  LIMIT 1
)
WHERE `primary_block_id` IS NULL;
