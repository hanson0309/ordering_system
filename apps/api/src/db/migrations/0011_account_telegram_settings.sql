ALTER TABLE `tenants` ADD COLUMN `account_user_id` text REFERENCES `users`(`id`);
--> statement-breakpoint
CREATE INDEX `tenants_account_user_idx` ON `tenants` (`account_user_id`);
--> statement-breakpoint
CREATE TABLE `account_telegram_settings` (
  `account_user_id` text PRIMARY KEY NOT NULL REFERENCES `users`(`id`),
  `value` text NOT NULL,
  `updated_at` integer NOT NULL DEFAULT (unixepoch())
);
--> statement-breakpoint
UPDATE `tenants`
SET `account_user_id` = substr(`id`, length('tenant_account_') + 1)
WHERE `id` LIKE 'tenant_account_%'
  AND EXISTS (
    SELECT 1 FROM `users`
    WHERE `users`.`id` = substr(`tenants`.`id`, length('tenant_account_') + 1)
      AND `users`.`is_platform_admin` = 0
  );
--> statement-breakpoint
UPDATE `tenants`
SET `account_user_id` = (
  SELECT `m`.`user_id`
  FROM `memberships` `m`
  INNER JOIN `users` `u` ON `u`.`id` = `m`.`user_id`
  WHERE `m`.`tenant_id` = `tenants`.`id`
    AND `m`.`role` = 'owner'
    AND `u`.`is_platform_admin` = 0
  LIMIT 1
)
WHERE `account_user_id` IS NULL
  AND (
    SELECT COUNT(*)
    FROM `memberships` `m`
    INNER JOIN `users` `u` ON `u`.`id` = `m`.`user_id`
    WHERE `m`.`tenant_id` = `tenants`.`id`
      AND `m`.`role` = 'owner'
      AND `u`.`is_platform_admin` = 0
  ) = 1;
--> statement-breakpoint
DELETE FROM `system_settings` WHERE `key` = 'telegram';
