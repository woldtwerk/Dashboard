CREATE TABLE `drive_entries` (
	`service` text NOT NULL,
	`path` text NOT NULL,
	`parent` text NOT NULL,
	`uid` text NOT NULL,
	`name` text NOT NULL,
	`name_search` text DEFAULT '' NOT NULL,
	`type` text NOT NULL,
	`size` integer,
	`modified` text,
	`media_type` text,
	`web_url` text,
	PRIMARY KEY(`service`, `path`)
);
--> statement-breakpoint
CREATE INDEX `drive_entries_parent_idx` ON `drive_entries` (`service`,`parent`);--> statement-breakpoint
CREATE TABLE `drive_folders` (
	`service` text NOT NULL,
	`path` text NOT NULL,
	`listed_at` integer,
	`error` text,
	PRIMARY KEY(`service`, `path`)
);
--> statement-breakpoint
CREATE TABLE `drive_sync` (
	`service` text PRIMARY KEY NOT NULL,
	`synced_at` integer,
	`error` text
);
