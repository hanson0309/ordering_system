# Payment QR and Receipt Upload Design

## Goal

Allow each menu location to show a seller payment QR code, let customers upload a payment receipt after submitting an order, and let authorized dashboard users view or download the receipt without sending it to Telegram.

## Confirmed behavior

- Each branch/location can have its own payment QR code.
- The default branch QR code is the fallback when the selected location has no QR code.
- QR codes are managed in the dashboard and stored in Cloudflare R2.
- After order creation, the customer sees the applicable QR code and order total on the confirmation page.
- Customers can upload one image or PDF receipt for the order.
- Receipts are stored in Cloudflare R2 and are not sent to Telegram.
- Dashboard users can view/download the receipt; payment remains manually confirmed by the seller.
- Accepted receipt files: JPEG, PNG, WebP, or PDF; maximum 5 MB.

## Data model

- `branches.payment_qr_key`: nullable R2 object key for the branch QR code.
- `orders.payment_receipt_key`: nullable R2 object key for the uploaded receipt.
- `orders.payment_receipt_content_type`: nullable MIME type used for downloads.
- `orders.payment_receipt_uploaded_at`: nullable timestamp.

## API

- Public menu response includes `paymentQrUrl` when a QR is available.
- `POST /api/dashboard/branches/:branchId/payment-qr` accepts multipart image upload.
- `DELETE /api/dashboard/branches/:branchId/payment-qr` removes a branch QR code.
- `POST /api/public/:slug/orders/:orderId/payment-receipt` accepts a multipart receipt upload and verifies tenant/branch ownership.
- `GET /api/dashboard/orders/:orderId/payment-receipt` streams a receipt to an authenticated dashboard user.
- Dashboard order list includes whether a receipt exists.

## Security and limits

- Dashboard QR mutations require an authenticated admin or owner.
- Receipt upload is scoped to the public tenant and branch resolved from the storefront URL; order IDs are opaque but are still checked server-side.
- R2 object keys contain tenant and order/branch IDs; no user-provided path is used.
- Uploads are checked by MIME type and byte length before being written.
- Receipt downloads require dashboard authentication and tenant scoping.
