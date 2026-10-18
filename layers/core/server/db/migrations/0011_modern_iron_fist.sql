CREATE TABLE `automation_workflows` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`domain` text NOT NULL,
	`service` text,
	`enabled` integer DEFAULT true NOT NULL,
	`mode` text DEFAULT 'suggest' NOT NULL,
	`position` integer NOT NULL,
	`graph` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `automation_workflows_domain_idx` ON `automation_workflows` (`domain`);--> statement-breakpoint
CREATE INDEX `automation_workflows_position_idx` ON `automation_workflows` (`position`);