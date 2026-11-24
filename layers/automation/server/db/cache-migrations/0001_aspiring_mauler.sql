CREATE TABLE `automation_activation` (
	`domain` text NOT NULL,
	`service` text NOT NULL,
	`since` text NOT NULL,
	`at` integer NOT NULL,
	PRIMARY KEY(`domain`, `service`)
);
