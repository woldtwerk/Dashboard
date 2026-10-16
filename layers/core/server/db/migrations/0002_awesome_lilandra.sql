CREATE TABLE `mail_index_mailboxes` (
	`service` text NOT NULL,
	`mailbox` text NOT NULL,
	`uid_validity` text NOT NULL,
	`complete` integer DEFAULT false NOT NULL,
	`synced_at` integer,
	PRIMARY KEY(`service`, `mailbox`),
	FOREIGN KEY (`service`) REFERENCES `services`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `mail_index_messages` (
	`service` text NOT NULL,
	`mailbox` text NOT NULL,
	`uid` integer NOT NULL,
	`unread` integer NOT NULL,
	`flagged` integer NOT NULL,
	PRIMARY KEY(`service`, `mailbox`, `uid`),
	FOREIGN KEY (`service`) REFERENCES `services`(`id`) ON UPDATE no action ON DELETE cascade
);
