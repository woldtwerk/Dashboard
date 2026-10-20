CREATE TABLE `contacts_address_books` (
	`service` text NOT NULL,
	`url` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`ctag` text,
	`sync_token` text,
	PRIMARY KEY(`service`, `url`)
);
--> statement-breakpoint
CREATE TABLE `contacts_cards` (
	`service` text NOT NULL,
	`address_book_url` text NOT NULL,
	`url` text NOT NULL,
	`etag` text,
	`uid` text NOT NULL,
	`data` text NOT NULL,
	PRIMARY KEY(`service`, `url`)
);
--> statement-breakpoint
CREATE INDEX `contacts_cards_address_book_idx` ON `contacts_cards` (`service`,`address_book_url`);--> statement-breakpoint
CREATE TABLE `contacts_sync` (
	`service` text PRIMARY KEY NOT NULL,
	`synced_at` integer,
	`error` text,
	`version` integer DEFAULT 0 NOT NULL
);
