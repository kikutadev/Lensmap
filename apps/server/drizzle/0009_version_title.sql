ALTER TABLE `artifact_versions` ADD `title` text;
--> statement-breakpoint
UPDATE `artifact_versions`
SET `title` = (
  SELECT `title` FROM `insight_artifacts`
  WHERE `insight_artifacts`.`id` = `artifact_versions`.`artifact_id`
)
WHERE `title` IS NULL;
