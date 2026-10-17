ALTER TABLE `branches` ADD `slug` text;
--> statement-breakpoint
ALTER TABLE `branches` ADD `is_default` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `branches_tenant_slug_unique` ON `branches` (`tenant_id`,`slug`);
--> statement-breakpoint
ALTER TABLE `categories` ADD `branch_id` text REFERENCES branches(id);
--> statement-breakpoint
CREATE INDEX `categories_branch_idx` ON `categories` (`tenant_id`,`branch_id`);
--> statement-breakpoint
ALTER TABLE `products` ADD `branch_id` text REFERENCES branches(id);
--> statement-breakpoint
CREATE INDEX `products_branch_idx` ON `products` (`tenant_id`,`branch_id`);
--> statement-breakpoint
ALTER TABLE `orders` ADD `branch_id` text REFERENCES branches(id);
--> statement-breakpoint
CREATE INDEX `orders_branch_status_created_idx` ON `orders` (`tenant_id`,`branch_id`,`status`,`created_at`);
