CREATE VIRTUAL TABLE `media_fts` USING fts5(
	media_item_id UNINDEXED,
	title,
	filename,
	categories,
	tokenize = 'unicode61 remove_diacritics 2'
);
