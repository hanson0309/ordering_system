-- Give every non-platform account a private, initially empty tenant. Legacy
-- records stay in their original tenants, where only the platform admin can
-- access them after ordinary memberships are moved.
INSERT OR IGNORE INTO `tenants` (`id`, `slug`, `name`, `status`)
SELECT
  'tenant_account_' || `id`,
  'account-' || replace(lower(`id`), '_', '-'),
  CASE
    WHEN instr(`email`, '@') > 1 THEN substr(`email`, 1, instr(`email`, '@') - 1)
    ELSE 'Account'
  END,
  'active'
FROM `users`
WHERE `is_platform_admin` = 0;
--> statement-breakpoint
INSERT OR IGNORE INTO `memberships` (`id`, `user_id`, `tenant_id`, `role`)
SELECT
  'mem_account_' || `user_id`,
  `user_id`,
  'tenant_account_' || `user_id`,
  COALESCE(`role`, 'admin')
FROM (
  SELECT
    u.`id` AS `user_id`,
    m.`role` AS `role`,
    ROW_NUMBER() OVER (
      PARTITION BY u.`id`
      ORDER BY
        CASE m.`role`
          WHEN 'viewer' THEN 0
          WHEN 'staff' THEN 1
          WHEN 'admin' THEN 2
          WHEN 'owner' THEN 3
          ELSE 0
        END ASC,
        m.`created_at` ASC
    ) AS `role_rank`
  FROM `users` u
  LEFT JOIN `memberships` m ON m.`user_id` = u.`id`
  WHERE u.`is_platform_admin` = 0
)
WHERE `role_rank` = 1;
--> statement-breakpoint
DELETE FROM `memberships`
WHERE `user_id` IN (SELECT `id` FROM `users` WHERE `is_platform_admin` = 0)
  AND `tenant_id` <> 'tenant_account_' || `user_id`;
--> statement-breakpoint
UPDATE `sessions`
SET `active_tenant_id` = 'tenant_account_' || `user_id`
WHERE `user_id` IN (SELECT `id` FROM `users` WHERE `is_platform_admin` = 0);
