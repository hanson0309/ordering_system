ALTER TABLE `branches` ADD `payment_qr_key` text;
ALTER TABLE `orders` ADD `payment_receipt_key` text;
ALTER TABLE `orders` ADD `payment_receipt_content_type` text;
ALTER TABLE `orders` ADD `payment_receipt_uploaded_at` integer;
