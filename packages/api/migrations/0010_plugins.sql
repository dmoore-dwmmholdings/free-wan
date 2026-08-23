CREATE TABLE `plugins` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`version` text NOT NULL,
	`description` text,
	`author` text,
	`icon` text,
	`main` text NOT NULL,
	`manifest` text NOT NULL,
	`permissions` text DEFAULT '[]' NOT NULL,
	`daemon` integer DEFAULT 0 NOT NULL,
	`enabled` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'installed' NOT NULL CHECK (`status` IN ('installed','active','error','disabled')),
	`last_error` text,
	`config` text DEFAULT '{}' NOT NULL,
	`install_path` text NOT NULL,
	`installed_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`installed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `plugin_kv` (
	`plugin_id` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`plugin_id`, `key`),
	FOREIGN KEY (`plugin_id`) REFERENCES `plugins`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `plugin_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`plugin_id` text NOT NULL,
	`kind` text NOT NULL CHECK (`kind` IN ('command','event','action','activate')),
	`ref` text,
	`user_id` text,
	`input` text,
	`output` text,
	`error` text,
	`status` text NOT NULL CHECK (`status` IN ('queued','running','succeeded','failed','timeout')),
	`started_at` integer,
	`finished_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`plugin_id`) REFERENCES `plugins`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_plugin_runs_plugin` ON `plugin_runs` (`plugin_id`,`created_at`);
