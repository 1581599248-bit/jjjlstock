CREATE TABLE `manager_overview_cache` (
	`cache_key` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`period` text NOT NULL,
	`manager_id` text NOT NULL,
	`payload` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `manager_overview_company_period_idx` ON `manager_overview_cache` (`company_id`,`period`);--> statement-breakpoint
CREATE INDEX `manager_overview_updated_at_idx` ON `manager_overview_cache` (`updated_at`);