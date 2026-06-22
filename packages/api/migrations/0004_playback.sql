CREATE TABLE `playback_progress` (
	`user_id` text NOT NULL,
	`media_item_id` text NOT NULL,
	`position_s` real NOT NULL,
	`duration_s` real,
	`watched` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `media_item_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`media_item_id`) REFERENCES `media_items`(`id`) ON UPDATE no action ON DELETE cascade
);
