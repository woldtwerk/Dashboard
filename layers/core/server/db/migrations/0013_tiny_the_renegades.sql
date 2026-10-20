CREATE TABLE `automation_drive_files` (
	`service` text NOT NULL,
	`folder` text NOT NULL,
	`sha256` text NOT NULL,
	`path` text NOT NULL,
	`size` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `automation_drive_files_service_folder_sha256_idx` ON `automation_drive_files` (`service`,`folder`,`sha256`);