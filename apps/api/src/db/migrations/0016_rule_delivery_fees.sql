ALTER TABLE `pricing_rules` ADD COLUMN `delivery_fee_sen` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
UPDATE `pricing_rules`
SET `delivery_fee_sen` = COALESCE((
  SELECT CASE WHEN MIN(`price_sen`) = MAX(`price_sen`) THEN MIN(`price_sen`) ELSE 0 END
  FROM `scheduled_meal_prices`
  WHERE `scheduled_meal_prices`.`pricing_rule_id` = `pricing_rules`.`id`
), 0);
--> statement-breakpoint
ALTER TABLE `orders` ADD COLUMN `delivery_fee_sen_snapshot` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `orders` ADD COLUMN `pricing_rule_name_snapshot` text;
