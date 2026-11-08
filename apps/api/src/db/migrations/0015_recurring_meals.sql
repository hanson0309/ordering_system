ALTER TABLE `branches` ADD COLUMN `delivery_period` text;
--> statement-breakpoint
ALTER TABLE `products` ADD COLUMN `weekly_day` integer;
--> statement-breakpoint
ALTER TABLE `products` ADD COLUMN `weekly_cutoff_time` text;
