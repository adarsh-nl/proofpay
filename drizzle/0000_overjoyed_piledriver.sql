CREATE TABLE `criteria` (
	`id` text NOT NULL,
	`job_id` text NOT NULL,
	`label` text NOT NULL,
	`how_to_verify` text NOT NULL,
	`required` integer NOT NULL,
	`weight` real NOT NULL,
	`phase` text NOT NULL,
	`source` text NOT NULL,
	PRIMARY KEY(`job_id`, `id`),
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `criteria_job_idx` ON `criteria` (`job_id`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` text NOT NULL,
	`type` text NOT NULL,
	`from_status` text,
	`to_status` text,
	`actor` text NOT NULL,
	`data_json` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `events_job_idx` ON `events` (`job_id`);--> statement-breakpoint
CREATE TABLE `evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`phase` text NOT NULL,
	`path` text NOT NULL,
	`mime` text NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`sha256` text NOT NULL,
	`dhash` text NOT NULL,
	`exif_taken_at` text,
	`exif_json` text,
	`uploaded_at` text NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `evidence_job_idx` ON `evidence` (`job_id`);--> statement-breakpoint
CREATE INDEX `evidence_sha256_idx` ON `evidence` (`sha256`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`category` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`status` text DEFAULT 'CREATED' NOT NULL,
	`liveness_code` text,
	`customer_name` text,
	`worker_name` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `jobs_status_idx` ON `jobs` (`status`);--> statement-breakpoint
CREATE TABLE `payments` (
	`job_id` text PRIMARY KEY NOT NULL,
	`paypal_order_id` text,
	`authorization_id` text,
	`authorization_status` text,
	`authorized_cents` integer DEFAULT 0 NOT NULL,
	`authorization_expires_at` text,
	`honor_period_ends_at` text,
	`captured_cents` integer DEFAULT 0 NOT NULL,
	`capture_ids` text,
	`refunded_cents` integer DEFAULT 0 NOT NULL,
	`voided_at` text,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `paypal_idempotency` (
	`key` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`response_json` text
);
--> statement-breakpoint
CREATE TABLE `verifications` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`attempt` integer NOT NULL,
	`model` text NOT NULL,
	`mock` integer DEFAULT false NOT NULL,
	`report_json` text NOT NULL,
	`forensics_json` text NOT NULL,
	`decision_json` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `verifications_job_idx` ON `verifications` (`job_id`);