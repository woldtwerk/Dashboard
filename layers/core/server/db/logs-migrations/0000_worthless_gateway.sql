CREATE TABLE `log_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`at` integer NOT NULL,
	`level` text NOT NULL,
	`domain` text NOT NULL,
	`service` text,
	`message` text NOT NULL,
	`meta` text
);
--> statement-breakpoint
CREATE INDEX `log_entries_at_idx` ON `log_entries` (`at`);--> statement-breakpoint
CREATE INDEX `log_entries_domain_at_idx` ON `log_entries` (`domain`,`at`);--> statement-breakpoint
CREATE INDEX `log_entries_level_at_idx` ON `log_entries` (`level`,`at`);--> statement-breakpoint
CREATE TABLE `logs_state` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sync_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`domain` text NOT NULL,
	`service` text NOT NULL,
	`started_at` integer NOT NULL,
	`duration_ms` integer NOT NULL,
	`ok` integer NOT NULL,
	`changed` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sync_runs_domain_started_at_idx` ON `sync_runs` (`domain`,`started_at`);