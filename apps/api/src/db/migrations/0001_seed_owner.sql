-- The dashboard is invite-only. This is the initial administrator account;
-- the password is stored as a PBKDF2 hash, never as plaintext.
INSERT INTO `tenants` (`id`, `slug`, `name`, `status`)
VALUES ('tenant_hanson', 'hanson', 'Hanson', 'active');
--> statement-breakpoint
INSERT INTO `users` (`id`, `email`, `password_hash`, `is_platform_admin`)
VALUES (
  'user_hansonng00',
  'hansonng00@gmail.com',
  'pbkdf2:100000:1788619cbdd042c6cce7d91031ead097:6c6c50bfb5c82408ce5cefa39fdf55c2c3bb5e79b51c0463a7370c95623a41ae',
  0
);
--> statement-breakpoint
INSERT INTO `memberships` (`id`, `user_id`, `tenant_id`, `role`)
VALUES ('mem_hanson_owner', 'user_hansonng00', 'tenant_hanson', 'owner');
