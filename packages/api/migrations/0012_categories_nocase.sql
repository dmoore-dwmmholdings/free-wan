CREATE TABLE `cat_case_dups` AS
SELECT c.id AS dup_id, k.id AS keep_id
FROM categories c
JOIN (
  SELECT repository_id, lower(path) AS lp, min(rowid) AS keep_rowid
  FROM categories
  GROUP BY repository_id, lower(path)
) g ON c.repository_id = g.repository_id AND lower(c.path) = g.lp
JOIN categories k ON k.rowid = g.keep_rowid
WHERE c.rowid <> g.keep_rowid;
--> statement-breakpoint
INSERT OR IGNORE INTO media_categories (media_item_id, category_id, is_leaf)
SELECT mc.media_item_id, d.keep_id, mc.is_leaf
FROM media_categories mc
JOIN cat_case_dups d ON mc.category_id = d.dup_id;
--> statement-breakpoint
DELETE FROM media_categories WHERE category_id IN (SELECT dup_id FROM cat_case_dups);
--> statement-breakpoint
UPDATE categories SET parent_id = (SELECT keep_id FROM cat_case_dups WHERE dup_id = parent_id)
WHERE parent_id IN (SELECT dup_id FROM cat_case_dups);
--> statement-breakpoint
DELETE FROM categories WHERE id IN (SELECT dup_id FROM cat_case_dups);
--> statement-breakpoint
UPDATE categories SET item_count = (SELECT COUNT(*) FROM media_categories WHERE category_id = categories.id)
WHERE id IN (SELECT keep_id FROM cat_case_dups);
--> statement-breakpoint
DROP TABLE `cat_case_dups`;
--> statement-breakpoint
DROP INDEX `idx_categories_repo_path`;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_categories_repo_path` ON `categories` (`repository_id`,`path` COLLATE NOCASE);
