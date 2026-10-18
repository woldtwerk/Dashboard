CREATE TABLE `app_passwords` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`scopes` text NOT NULL,
	`token_hash` text NOT NULL,
	`prefix` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `app_passwords_token_hash_unique` ON `app_passwords` (`token_hash`);