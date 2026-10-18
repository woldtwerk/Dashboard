CREATE TABLE `automation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`workflow` text NOT NULL,
	`workflow_name` text NOT NULL,
	`domain` text NOT NULL,
	`service` text NOT NULL,
	`item_key` text NOT NULL,
	`item` text NOT NULL,
	`path` text NOT NULL,
	`answers` text NOT NULL,
	`outcome` text NOT NULL,
	`actions` text NOT NULL,
	`applied` text NOT NULL,
	`error` text,
	`feedback` text,
	`at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `automation_runs_at_idx` ON `automation_runs` (`at`);--> statement-breakpoint
CREATE INDEX `automation_runs_domain_at_idx` ON `automation_runs` (`domain`,`at`);--> statement-breakpoint
CREATE INDEX `automation_runs_outcome_idx` ON `automation_runs` (`outcome`);--> statement-breakpoint
CREATE TABLE `automation_seen` (
	`domain` text NOT NULL,
	`service` text NOT NULL,
	`item_key` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer,
	`at` integer NOT NULL,
	PRIMARY KEY(`domain`, `service`, `item_key`)
);
--> statement-breakpoint
CREATE INDEX `automation_seen_next_attempt_idx` ON `automation_seen` (`next_attempt_at`);--> statement-breakpoint
CREATE TABLE `automation_sweep` (
	`domain` text NOT NULL,
	`service` text NOT NULL,
	`cursor` text,
	`at` integer NOT NULL,
	PRIMARY KEY(`domain`, `service`)
);
