CREATE TABLE `pricing_rules` (
  `id` text PRIMARY KEY NOT NULL,
  `tenant_id` text NOT NULL REFERENCES `tenants`(`id`),
  `name` text NOT NULL,
  `is_active` integer NOT NULL DEFAULT 1,
  `sort_order` integer NOT NULL DEFAULT 0,
  `created_at` integer NOT NULL DEFAULT (unixepoch()),
  `updated_at` integer NOT NULL DEFAULT (unixepoch())
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pricing_rules_tenant_name_unique` ON `pricing_rules` (`tenant_id`, `name`);
--> statement-breakpoint
CREATE INDEX `pricing_rules_tenant_sort_idx` ON `pricing_rules` (`tenant_id`, `sort_order`);
--> statement-breakpoint
ALTER TABLE `branches` ADD COLUMN `pricing_rule_id` text REFERENCES `pricing_rules`(`id`);
--> statement-breakpoint
ALTER TABLE `products` ADD COLUMN `service_date` text;
--> statement-breakpoint
ALTER TABLE `products` ADD COLUMN `service_period` text;
--> statement-breakpoint
ALTER TABLE `products` ADD COLUMN `order_cutoff_at` integer;
--> statement-breakpoint
ALTER TABLE `order_items` ADD COLUMN `service_date_snapshot` text;
--> statement-breakpoint
ALTER TABLE `order_items` ADD COLUMN `service_period_snapshot` text;
--> statement-breakpoint
ALTER TABLE `order_items` ADD COLUMN `pricing_rule_name_snapshot` text;
--> statement-breakpoint
CREATE TABLE `scheduled_meal_prices` (
  `id` text PRIMARY KEY NOT NULL,
  `tenant_id` text NOT NULL REFERENCES `tenants`(`id`),
  `product_id` text NOT NULL REFERENCES `products`(`id`),
  `pricing_rule_id` text NOT NULL REFERENCES `pricing_rules`(`id`),
  `price_sen` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `scheduled_meal_prices_product_rule_unique` ON `scheduled_meal_prices` (`product_id`, `pricing_rule_id`);
--> statement-breakpoint
CREATE INDEX `scheduled_meal_prices_tenant_idx` ON `scheduled_meal_prices` (`tenant_id`);
--> statement-breakpoint
CREATE INDEX `scheduled_meal_prices_rule_idx` ON `scheduled_meal_prices` (`pricing_rule_id`);
