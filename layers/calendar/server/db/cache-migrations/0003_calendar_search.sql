CREATE VIRTUAL TABLE IF NOT EXISTS `calendar_search` USING fts5(service UNINDEXED, url UNINDEXED, summary, description, location, people, categories, tokenize='trigram');
