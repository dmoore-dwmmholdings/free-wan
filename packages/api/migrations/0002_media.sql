CREATE TABLE `repositories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`root_path` text NOT NULL,
	`type` text NOT NULL CHECK (`type` IN ('video','image','mixed')),
	`enabled` integer DEFAULT 1 NOT NULL,
	`read_only` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'unknown' NOT NULL CHECK (`status` IN ('unknown','online','offline','scanning','error')),
	`last_scan_at` integer,
	`last_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `media_items` (
	`id` text PRIMARY KEY NOT NULL,
	`repository_id` text NOT NULL,
	`rel_path` text NOT NULL,
	`type` text NOT NULL CHECK (`type` IN ('video','image')),
	`title` text NOT NULL,
	`ext` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`file_mtime` integer NOT NULL,
	`content_hash` text,
	`duration_s` real,
	`width` integer,
	`height` integer,
	`frame_rate` real,
	`bitrate` integer,
	`container` text,
	`video_codec` text,
	`audio_codec` text,
	`audio_tracks` integer DEFAULT 0,
	`has_embedded_subs` integer DEFAULT 0 NOT NULL,
	`captured_at` integer,
	`orientation` integer,
	`poster_path` text,
	`sprite_path` text,
	`playback_mode` text CHECK (`playback_mode` IN ('direct','hls')),
	`status` text DEFAULT 'active' NOT NULL CHECK (`status` IN ('active','offline','missing')),
	`added_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_items_repo_rel` ON `media_items` (`repository_id`,`rel_path`);
--> statement-breakpoint
CREATE INDEX `idx_items_repo` ON `media_items` (`repository_id`);
--> statement-breakpoint
CREATE INDEX `idx_items_type` ON `media_items` (`type`);
--> statement-breakpoint
CREATE INDEX `idx_items_added` ON `media_items` (`added_at`);
--> statement-breakpoint
CREATE INDEX `idx_items_duration` ON `media_items` (`duration_s`);
--> statement-breakpoint
CREATE INDEX `idx_items_status` ON `media_items` (`status`);
--> statement-breakpoint
CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`repository_id` text NOT NULL,
	`parent_id` text,
	`name` text NOT NULL,
	`path` text NOT NULL,
	`depth` integer NOT NULL,
	`item_count` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_categories_repo_path` ON `categories` (`repository_id`,`path`);
--> statement-breakpoint
CREATE INDEX `idx_categories_parent` ON `categories` (`parent_id`);
--> statement-breakpoint
CREATE TABLE `media_categories` (
	`media_item_id` text NOT NULL,
	`category_id` text NOT NULL,
	`is_leaf` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`media_item_id`, `category_id`),
	FOREIGN KEY (`media_item_id`) REFERENCES `media_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_mediacat_cat` ON `media_categories` (`category_id`);
--> statement-breakpoint
CREATE TABLE `subtitle_tracks` (
	`id` text PRIMARY KEY NOT NULL,
	`media_item_id` text NOT NULL,
	`kind` text NOT NULL CHECK (`kind` IN ('embedded','sidecar')),
	`language` text,
	`label` text,
	`format` text,
	`stream_index` integer,
	`rel_path` text,
	FOREIGN KEY (`media_item_id`) REFERENCES `media_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_subs_item` ON `subtitle_tracks` (`media_item_id`);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`status` text NOT NULL CHECK (`status` IN ('queued','running','succeeded','failed','canceled')),
	`priority` integer DEFAULT 0 NOT NULL,
	`progress` real DEFAULT 0 NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_jobs_status` ON `jobs` (`status`,`priority`);
