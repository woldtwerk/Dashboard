CREATE TABLE `services` (
	`id` text PRIMARY KEY NOT NULL,
	`connector` text NOT NULL,
	`domain` text NOT NULL,
	`name` text NOT NULL,
	`icon` text,
	`settings` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `services_domain_idx` ON `services` (`domain`);