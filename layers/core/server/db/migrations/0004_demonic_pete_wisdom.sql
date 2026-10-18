CREATE TABLE `calendar_preferences` (
	`service` text NOT NULL,
	`calendar_url` text NOT NULL,
	`hidden` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`service`, `calendar_url`),
	FOREIGN KEY (`service`) REFERENCES `services`(`id`) ON UPDATE no action ON DELETE cascade
);
