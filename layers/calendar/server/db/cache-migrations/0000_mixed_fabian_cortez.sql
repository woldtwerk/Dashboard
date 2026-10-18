CREATE TABLE `calendar_collections` (
	`service` text NOT NULL,
	`url` text NOT NULL,
	`name` text NOT NULL,
	`color` text,
	`description` text,
	`ctag` text,
	`sync_token` text,
	`synced_at` integer,
	PRIMARY KEY(`service`, `url`)
);
--> statement-breakpoint
CREATE TABLE `calendar_objects` (
	`service` text NOT NULL,
	`calendar_url` text NOT NULL,
	`url` text NOT NULL,
	`etag` text,
	`uid` text NOT NULL,
	`data` text NOT NULL,
	`first_start` integer NOT NULL,
	`last_end` integer,
	PRIMARY KEY(`service`, `url`)
);
--> statement-breakpoint
CREATE INDEX `calendar_objects_calendar_start_idx` ON `calendar_objects` (`service`,`calendar_url`,`first_start`);--> statement-breakpoint
CREATE TABLE `calendar_sync` (
	`service` text PRIMARY KEY NOT NULL,
	`synced_at` integer,
	`error` text
);
