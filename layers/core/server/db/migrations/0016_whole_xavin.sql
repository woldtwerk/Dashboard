CREATE TABLE `payment_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`service` text NOT NULL,
	`source` text,
	`cents` integer NOT NULL,
	`via` text NOT NULL,
	`received_at` integer NOT NULL,
	FOREIGN KEY (`request_id`) REFERENCES `payment_requests`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_receipts_service_source_idx` ON `payment_receipts` (`service`,`source`);--> statement-breakpoint
CREATE INDEX `payment_receipts_request_id_idx` ON `payment_receipts` (`request_id`);--> statement-breakpoint
CREATE TABLE `payment_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`service` text NOT NULL,
	`reference` text NOT NULL,
	`title` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`currency` text DEFAULT 'EUR' NOT NULL,
	`payer_name` text NOT NULL,
	`payer_email` text,
	`contact_service` text,
	`contact_uid` text,
	`batch_id` text,
	`status` text NOT NULL,
	`paid_cents` integer DEFAULT 0 NOT NULL,
	`paid_at` integer,
	`paid_via` text,
	`sent_at` integer,
	`created_at` integer NOT NULL,
	`origin` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_requests_reference_unique` ON `payment_requests` (`reference`);--> statement-breakpoint
CREATE INDEX `payment_requests_service_status_idx` ON `payment_requests` (`service`,`status`);--> statement-breakpoint
CREATE INDEX `payment_requests_batch_id_idx` ON `payment_requests` (`batch_id`);