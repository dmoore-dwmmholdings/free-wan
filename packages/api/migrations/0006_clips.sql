CREATE TABLE `clips` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`source_item_id` text,
	`name` text NOT NULL,
	`start_s` real NOT NULL,
	`end_s` real NOT NULL,
	`loop` integer DEFAULT 1 NOT NULL,
	`poster_path` text,
	`export_path` text,
	`export_status` text DEFAULT 'none' NOT NULL CHECK (`export_status` IN ('none','queued','rendering','ready','failed')),
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CHECK (`end_s` > `start_s`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_item_id`) REFERENCES `media_items`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_clips_user` ON `clips` (`user_id`);
