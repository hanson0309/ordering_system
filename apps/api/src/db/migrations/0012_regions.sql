CREATE TABLE `regions` (
  `id` text PRIMARY KEY NOT NULL,
  `tenant_id` text NOT NULL REFERENCES `tenants`(`id`),
  `name` text NOT NULL,
  `slug` text NOT NULL,
  `is_default` integer NOT NULL DEFAULT 0,
  `created_at` integer NOT NULL DEFAULT (unixepoch())
);
--> statement-breakpoint
CREATE UNIQUE INDEX `regions_tenant_slug_unique` ON `regions` (`tenant_id`, `slug`);
--> statement-breakpoint
CREATE INDEX `regions_tenant_idx` ON `regions` (`tenant_id`);
--> statement-breakpoint
INSERT INTO `regions` (`id`, `tenant_id`, `name`, `slug`, `is_default`)
SELECT 'region_default_' || `id`, `id`, 'Main Region', 'main', 1
FROM `tenants`;
--> statement-breakpoint
ALTER TABLE `branches` ADD COLUMN `region_id` text REFERENCES `regions`(`id`);
--> statement-breakpoint
UPDATE `branches` SET `region_id` = 'region_default_' || `tenant_id`;
--> statement-breakpoint
CREATE TRIGGER `branches_region_insert_required`
BEFORE INSERT ON `branches`
WHEN NEW.`region_id` IS NULL
BEGIN
  SELECT RAISE(ABORT, 'branches.region_id is required');
END;
--> statement-breakpoint
CREATE TRIGGER `branches_region_update_required`
BEFORE UPDATE OF `region_id` ON `branches`
WHEN NEW.`region_id` IS NULL
BEGIN
  SELECT RAISE(ABORT, 'branches.region_id is required');
END;
--> statement-breakpoint
CREATE INDEX `branches_region_idx` ON `branches` (`region_id`);
--> statement-breakpoint
DROP INDEX `branches_tenant_slug_unique`;
--> statement-breakpoint
CREATE UNIQUE INDEX `branches_region_slug_unique` ON `branches` (`region_id`, `slug`);
