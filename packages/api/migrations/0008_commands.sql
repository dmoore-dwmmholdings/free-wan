CREATE TABLE `commands` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`executable` text NOT NULL,
	`arg_template` text NOT NULL,
	`working_dir` text,
	`timeout_s` integer DEFAULT 600 NOT NULL,
	`max_output_kb` integer DEFAULT 1024 NOT NULL,
	`env_allowlist` text DEFAULT '[]' NOT NULL,
	`allow_non_admin` integer DEFAULT 0 NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`is_internal` integer DEFAULT 0 NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `command_params` (
	`id` text PRIMARY KEY NOT NULL,
	`command_id` text NOT NULL,
	`name` text NOT NULL,
	`label` text NOT NULL,
	`type` text NOT NULL CHECK (`type` IN ('string','number','boolean','enum','repo_path')),
	`required` integer DEFAULT 0 NOT NULL,
	`default_value` text,
	`constraints` text,
	`position` integer NOT NULL,
	FOREIGN KEY (`command_id`) REFERENCES `commands`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_command_params_cmd_name` ON `command_params` (`command_id`,`name`);
--> statement-breakpoint
CREATE TABLE `command_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`command_id` text NOT NULL,
	`user_id` text,
	`args` text NOT NULL,
	`resolved_argv` text NOT NULL,
	`status` text NOT NULL CHECK (`status` IN ('queued','running','succeeded','failed','canceled','timeout')),
	`exit_code` integer,
	`output_path` text,
	`output_text` text,
	`truncated` integer DEFAULT 0 NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`command_id`) REFERENCES `commands`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_runs_cmd` ON `command_runs` (`command_id`);
--> statement-breakpoint
CREATE INDEX `idx_runs_user` ON `command_runs` (`user_id`);
