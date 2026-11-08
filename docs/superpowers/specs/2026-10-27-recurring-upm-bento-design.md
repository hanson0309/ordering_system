# Recurring UPM Bento Menu Design

## Goal

Configure the `aa1234` tenant with UPM delivery locations and a weekday bento menu that repeats weekly, while letting customers order a dated occurrence and seeing the price associated with the selected location.

## Confirmed behavior

- Reuse the existing `UPM` region. Keep its current `aa` location unchanged.
- Create separate morning/lunch and afternoon/dinner locations for every listed delivery point. Names use the format `<location> 上午` and `<location> 下午`.
- Every new UPM location uses the `UPM学生` rule. Create additional `校外` and `雪隆配送` rules for later assignment.
- Store the five weekday lunch and dinner dishes as recurring templates, and show occurrences for the next 14 calendar days in Malaysia time. Weekends have no offers.
- Lunch dispatch is 11:30 and ordering closes at 09:00; dinner dispatch is 18:00 and ordering closes at 13:00. The existing urgent-change messages (08:00/13:00) are informational and do not change the checkout cutoffs.
- Store an order against its actual service date, meal period, applied rule, and charged price. Later template edits must not change existing orders.
- Regular meals use RM8.50 for UPM students, RM10.00 for off-campus customers, and RM15.00 for Klang Valley delivery. The Wednesday lunch fish special is RM10.00 under UPM student pricing; other tiers remain RM10.00 and RM15.00.
- Keep `100plus` and Coca-Cola as ordinary add-ons at RM3.00 each. Do not duplicate or delete existing products without checking branch scope and order history.
- The “5 portions within 6 km free delivery” condition is informational only in this change; delivery-fee eligibility is not currently calculated by the ordering system.

## Architecture

- Extend products with an optional recurring weekday and local cutoff. A recurring product has a lunch/dinner period but no fixed service date; a dated product retains current behavior.
- Add a nullable delivery period to branches. Public menu resolution includes recurring products only when their period matches the selected branch.
- Public product reads expand recurring products into dated occurrences over the next 14 Malaysia-local calendar days. Each occurrence carries `serviceDate` and uses the existing branch pricing-rule lookup.
- Cart identity for recurring offers is `(productId, serviceDate)`. Order submission includes the selected service date; the API verifies the weekday, branch period, active price rule, and cutoff before saving immutable order snapshots.
- Dashboard product management can create/edit a recurring weekday meal or a one-off dated meal. Add-ons remain unchanged.

## Location names to configure

Parse the supplied lists into separate points: morning: K10, K17, ABCD, UVH, FPV, 图书馆, KC, Kossas, Kpz上, Kpz下, K12, K14; afternoon: K10, Kmr, One Putra, K17, ABCD, KC, Kossas, Kpz上, Kpz下, K12, K13, K14. Create one location per point and period, leaving the existing `aa` location intact.

## Verification

- Test weekday recurrence, two-week date expansion, Malaysia-time cutoffs, branch-period filtering, location-specific prices, and order snapshots.
- Test that the same recurring product can be placed on two different dates and that the same product/date cannot bypass the cutoff.
- Run all API tests and API, storefront, and dashboard builds before applying the additive production migration and deploying.
- After deployment, configure the `aa1234` tenant through authenticated dashboard APIs and verify menu/locations with read-only public API requests.
