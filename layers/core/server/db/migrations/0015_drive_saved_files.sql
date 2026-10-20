ALTER TABLE `automation_drive_files` RENAME TO `drive_saved_files`;
--> statement-breakpoint
DROP INDEX `automation_drive_files_service_folder_sha256_idx`;
--> statement-breakpoint
CREATE UNIQUE INDEX `drive_saved_files_service_folder_sha256_idx` ON `drive_saved_files` (`service`,`folder`,`sha256`);
