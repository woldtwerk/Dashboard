CREATE TABLE `assistant_chats` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`service` text,
	`model` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `assistant_chats_updated_at_idx` ON `assistant_chats` (`updated_at`);--> statement-breakpoint
CREATE TABLE `assistant_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`chat_id` text NOT NULL,
	`role` text NOT NULL,
	`parts` text NOT NULL,
	`created_at` integer NOT NULL,
	`position` integer NOT NULL,
	FOREIGN KEY (`chat_id`) REFERENCES `assistant_chats`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `assistant_messages_chat_position_idx` ON `assistant_messages` (`chat_id`,`position`);