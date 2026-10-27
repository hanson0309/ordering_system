# Weekly Bento Menu Design

## Goal

Turn the weekly bento schedule into a managed ordering workflow: customers see meals for a chosen date and service period, the server enforces ordering cutoffs, and each selected location applies its configured price rule automatically.

## Confirmed behavior

- Existing public location links remain the source of the pickup or delivery location. Customers do not enter a location during checkout.
- A weekly menu contains weekday meal offers for `lunch` and `dinner`. An offer records the service date, service period, dish name, description, image, and whether it is published.
- Lunch orders close at 09:00 Malaysia time by default; dinner orders close at 13:00 Malaysia time by default. Each offer can override that cutoff when needed.
- The customer menu groups offers by date and then service period. Offers past their cutoff are unavailable and cannot be submitted through a direct API request.
- Drinks and other add-ons remain ordinary products. They can be added to a scheduled meal but do not receive a service-period cutoff of their own.
- A price rule defines a named price tier, such as `UPM student`, `External pickup`, or `Klang Valley delivery`. A location is assigned one active rule.
- Each scheduled meal has a price for every applicable price rule. The customer sees only the price for their location's active rule. The dashboard can change rule names, prices, location assignments, and meal-specific prices without code changes.
- Each order item snapshots the scheduled service date, service period, and applied price rule so later menu changes never alter dispatch information or historical totals.
- The existing payment QR, automatic receipt upload, receipt cancellation, cart, and receipt review functions remain unchanged.

## Data model

### Pricing rules

- Add `pricing_rules`: `id`, `tenant_id`, `name`, `is_active`, `sort_order`, `created_at`, and `updated_at`.
- Add nullable `branches.pricing_rule_id`. A branch may have one active default rule; a missing rule means scheduled offers are unavailable at that location until the dashboard assigns one.
- Add `scheduled_meal_prices`: `id`, `tenant_id`, `product_id`, `pricing_rule_id`, and `price_sen`. The unique pair of product and rule prevents ambiguous prices.

### Scheduled meal products

- Extend `products` with nullable `service_date`, `service_period`, and `order_cutoff_at`.
- `service_period` is `lunch` or `dinner`; all three fields are null for ordinary products such as drinks.
- A scheduled product must have all three schedule fields and at least one active price-row before it is public. Existing products with null schedule fields keep their present behavior and price.
- Extend `order_items` with nullable snapshots: `service_date_snapshot`, `service_period_snapshot`, and `pricing_rule_name_snapshot`. Ordinary products retain null schedule snapshots.

## API

### Public storefront

- `GET /api/public/:tenantSlug/:regionSlug/:storeSlug/products` returns published, in-cutoff scheduled meals for the resolved branch, with the effective branch price, service metadata, and the ordinary add-on products.
- `POST /api/public/:tenantSlug/:regionSlug/:storeSlug/orders` validates every scheduled product against the current server time, branch rule assignment, product schedule, and meal price. It never accepts a customer-supplied price, date, period, or pricing rule.
- A product requested after `order_cutoff_at`, without a matching active price rule, or from another branch returns `invalid_order`.

### Dashboard

- Add dashboard CRUD endpoints for pricing rules and branch rule assignment. Rule changes require `admin` or `owner` access and remain tenant-scoped.
- Extend dashboard product creation and editing with service-date, service-period, cutoff, and per-rule price inputs. Existing ordinary products can remain unscheduled add-ons.
- Dashboard order responses include scheduled item snapshots so dispatch views can show date, meal period, location, and final applied price.

## Customer experience

1. The location link resolves the branch and its active pricing rule.
2. The page shows available scheduled meals under date and `Lunch` or `Dinner`, followed by add-ons.
3. A meal card shows its description, applicable price, and cutoff. A closed meal is not purchasable.
4. At checkout, the order remains tied to the current location. The server saves the schedule and pricing snapshots alongside existing order data.
5. The confirmation page continues to show payment QR and automatically upload a selected payment receipt. A customer may cancel an uploaded receipt and select a replacement.

## Dashboard experience

- A `Price rules` section lets an administrator add, rename, activate, reorder, or disable pricing rules and select a rule for each location.
- The product catalog marks an item as an ordinary add-on or a scheduled meal. Scheduled meal editing includes date, lunch/dinner, cutoff, description, and rule-specific prices.
- The order list and dispatch output identify scheduled date and meal period from immutable order-item snapshots. Unscheduled legacy orders remain visible as they are today.

## Validation and error handling

- Times are stored as UTC timestamps and calculated from Malaysia time in the dashboard; the API performs the final cutoff check.
- An offer cannot be made public without a date, meal period, cutoff, and price for the location rule that can buy it.
- Removing a price rule is blocked while locations or active scheduled meal prices still reference it. Administrators may deactivate a rule after reassignment instead.
- Reassigning a location rule affects only future cart and order requests. Saved orders keep the applied rule name and price snapshot.
- An existing order with no schedule snapshots is treated as a legacy ordinary order and continues to render in the dashboard.

## Verification

- API tests cover location-specific prices, price-rule tenant isolation, invalid rule assignment, cutoff enforcement in Malaysia time, scheduled metadata snapshots, and ordinary add-ons.
- Dashboard tests cover rule management and scheduled product validation.
- Storefront tests cover grouping, displayed effective price, closed-offer behavior, and automatic receipt upload/cancellation regression paths.
- Run the full API suite plus API, customer, and dashboard production builds before release.
