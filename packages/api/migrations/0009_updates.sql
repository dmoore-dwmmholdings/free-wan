CREATE TABLE `app_updates` (
	`id` text PRIMARY KEY NOT NULL,
	`version` text NOT NULL,
	`changelog` text,
	`status` text NOT NULL,
	`applied_at` integer NOT NULL,
	`note` text
);
