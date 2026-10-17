# Fixture and Golden Results

The demo dataset and the **expected output** of the scoring rules in [technical-spec.md §3](technical-spec.md). The expected values were computed by an independent reference implementation of those rules, so they are a test oracle: an implementation that disagrees is wrong (or the spec needs a deliberate change here *and* there).

All data is synthetic. Emails use the reserved `example.test` domain; hosted-invoice URLs use the reserved `.test` TLD. Nothing here is a real customer, card or Stripe object.

## 1. Constants

| Constant | Value |
| --- | --- |
| `FIXTURE_AS_OF` | `2026-10-17T12:00:00Z` (fixed so the demo and tests are deterministic) |
| Save the CSV below as | `data/fixtures/failed_payments.csv` |
| Uploaded-CSV `as_of` | the server's current time (not the fixture constant) |

## 2. Canonical CSV (13 rows)

```csv
customer_id,customer_email,invoice_id,subscription_id,amount_due,currency,failure_code,failure_message,failed_at,attempt_count,next_payment_attempt,invoice_status,customer_created_at,hosted_invoice_url
cus_synth_001,ava.stone@example.test,in_synth_001,sub_synth_001,49900,usd,expired_card,Your card has expired.,2026-10-15T08:10:00Z,1,,open,2024-09-02T00:00:00Z,https://example.test/hosted-invoice/in_synth_001
cus_synth_002,ben.ortiz@example.test,in_synth_002,sub_synth_002,8900,usd,insufficient_funds,Your card has insufficient funds.,2026-10-16T06:30:00Z,1,2026-10-19T06:30:00Z,open,2025-03-14T00:00:00Z,https://example.test/hosted-invoice/in_synth_002
cus_synth_003,cara.lund@example.test,in_synth_003,sub_synth_003,1900,usd,generic_decline,Your card was declined.,2026-10-14T14:00:00Z,1,,open,2025-11-20T00:00:00Z,https://example.test/hosted-invoice/in_synth_003
cus_synth_004,dev.patel@example.test,in_synth_004,sub_synth_004,14900,usd,insufficient_funds,Your card has insufficient funds.,2026-10-12T09:00:00Z,2,,paid,2023-06-01T00:00:00Z,https://example.test/hosted-invoice/in_synth_004
cus_synth_005,eli.wong@example.test,in_synth_005,sub_synth_005,24900,usd,generic_decline,Your card was declined.,2026-09-20T10:00:00Z,4,,uncollectible,2024-01-15T00:00:00Z,https://example.test/hosted-invoice/in_synth_005
cus_synth_006,fay.novak@example.test,in_synth_006,sub_synth_006,12900,usd,insufficient_funds,Your card has insufficient funds.,2026-10-09T11:00:00Z,3,,open,2024-05-05T00:00:00Z,https://example.test/hosted-invoice/in_synth_006
cus_synth_007,gus.reed@example.test,in_synth_007,sub_synth_007,7900,usd,authentication_required,This payment requires authentication.,2026-10-16T22:00:00Z,1,,open,2026-02-10T00:00:00Z,https://example.test/hosted-invoice/in_synth_007
cus_synth_008,hana.kim@example.test,in_synth_008,,19900,usd,generic_decline,,2026-10-13T05:00:00Z,2,unknown,open,,
cus_synth_009,ivan.cole@example.test,in_synth_009,sub_synth_009,32000,usd,generic_decline,Your card was declined.,2026-10-14T20:00:00Z,2,,open,2022-08-19T00:00:00Z,https://example.test/hosted-invoice/in_synth_009
cus_synth_010,jade.fox@example.test,in_synth_010,sub_synth_010,5900,usd,insufficient_funds,Your card has insufficient funds.,2026-10-16T18:00:00Z,1,2026-10-21T18:00:00Z,open,2025-09-09T00:00:00Z,https://example.test/hosted-invoice/in_synth_010
cus_synth_011,kai.bell@example.test,in_synth_011,sub_synth_011,2900,usd,expired_card,Your card has expired.,2026-10-17T02:00:00Z,1,,open,2026-10-07T00:00:00Z,https://example.test/hosted-invoice/in_synth_011
cus_synth_012,lena.moss@example.test,in_synth_012,sub_synth_012,9900,eur,expired_card,Your card has expired.,2026-10-15T13:00:00Z,1,,open,2025-06-30T00:00:00Z,https://example.test/hosted-invoice/in_synth_012
cus_synth_013,milo.dane@example.test,in_synth_013,sub_synth_013,6900,usd,lost_card,Your card was declined.,2026-10-16T09:00:00Z,1,,open,2025-01-12T00:00:00Z,https://example.test/hosted-invoice/in_synth_013
```

Notes on conventions in this file:

- `next_payment_attempt`: an ISO timestamp = retry scheduled; **empty** = no retry scheduled (Stripe semantics: `null`); the literal `unknown` = retry information unavailable (row 008 only).
- Row 013 (`lost_card`) has the generic failure message on purpose: Stripe says the real reason must not be disclosed to the customer, so even the provider-facing message is generic.
- Row 008 deliberately lacks `subscription_id`, `failure_message`, `customer_created_at`, `hosted_invoice_url`, and has `next_payment_attempt=unknown`, to demonstrate confidence handling.

## 3. What each row demonstrates (spec §18 coverage)

| Spec case | Row(s) |
| --- | --- |
| High-value payment, expired card | 001 |
| Medium-value insufficient funds with scheduled retry | 002, 010 |
| Low-value generic decline | 003 |
| Payment that later succeeds | 004 (`paid`) |
| Invoice no longer collectible | 005 (`uncollectible`) |
| Customer with multiple failed attempts | 006 (`attempt_count=3`) |
| Authentication-required failure | 007 |
| Missing optional data, confidence handling | 008 |
| High-value but ambiguous decline (highest amount is not most recoverable) | 009 |
| New customer (low tenure) | 011 |
| Second currency (never sum across currencies) | 012 (`eur`) |
| Non-disclosable decline reason | 013 (`lost_card`) |

## 4. Golden result A: full dataset, no filters

`records_total=13`, `records_in_scope=13`, queued items = 11, resolved = 2. Queues are ranked **per currency** (see technical-spec §3.4).

### USD queue

| Rank | invoice_id | amount_due | state | amount_norm | recovery | urgency | value | **score** | priority | confidence | recommended_action |
| ---: | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |
| 1 | in_synth_001 | 49900 | action_needed | 1.000 | 0.90 | 0.377 | 1.000 | **85.0** | urgent | high | update_payment_method |
| 2 | in_synth_009 | 32000 | action_needed | 0.641 | 0.35 | 0.395 | 1.000 | **55.5** | high | high | review_manually |
| 3 | in_synth_006 | 12900 | action_needed | 0.259 | 0.60 | 0.787 | 1.000 | **52.4** | high | high | contact_customer |
| 4 | in_synth_007 | 7900 | action_needed | 0.158 | 0.80 | 0.321 | 0.684 | **40.4** | medium | high | update_payment_method |
| 5 | in_synth_002 | 8900 | in_recovery | 0.178 | 0.60 | 0.044 | 1.000 | **33.9** | medium | high | wait_for_retry |
| 6 | in_synth_011 | 2900 | action_needed | 0.058 | 0.90 | 0.315 | 0.029 | **31.7** | medium | high | update_payment_method |
| 7 | in_synth_010 | 5900 | in_recovery | 0.118 | 0.60 | 0.027 | 1.000 | **30.9** | medium | high | wait_for_retry |
| 8 | in_synth_008 | 19900 | failed | 0.399 | 0.35 | 0.153 | 0.000 | **29.8** | low | **low** | review_manually |
| 9 | in_synth_003 | 1900 | action_needed | 0.038 | 0.35 | 0.404 | 0.908 | **27.6** | low | high | contact_customer |
| 10 | in_synth_013 | 6900 | action_needed | 0.138 | 0.10 | 0.340 | 1.000 | **25.5** | low | high | review_manually |

### EUR queue

| Rank | invoice_id | amount_due | state | amount_norm | recovery | urgency | value | **score** | priority | confidence | recommended_action |
| ---: | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |
| 1 | in_synth_012 | 9900 | action_needed | 1.000 | 0.90 | 0.370 | 1.000 | **84.9** | urgent | high | update_payment_method |

The lone EUR item is normalized against itself, so its score is not comparable to USD scores. The result **must** carry the warning `single_item_currency:eur` (technical-spec §4.2) and the UI must show it.

### Resolved (not in any queue)

| invoice_id | state | action | reason |
| --- | --- | --- | --- |
| in_synth_004 | recovered | do_not_pursue | Invoice is paid. |
| in_synth_005 | not_recovered | do_not_pursue | Invoice is uncollectible. |

### Metrics

| Currency | failed_count | affected_customers | amount_at_risk_minor | in_recovery_minor | action_needed_minor | failed_minor |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| usd | 10 | 10 | 149100 | 14800 | 114400 | 19900 |
| eur | 1 | 1 | 9900 | 0 | 9900 | 0 |

By failure code (queued items only):

| currency | failure_code | count | amount_minor |
| --- | --- | ---: | ---: |
| usd | generic_decline | 3 | 53800 |
| usd | expired_card | 2 | 52800 |
| usd | insufficient_funds | 3 | 27700 |
| usd | authentication_required | 1 | 7900 |
| usd | lost_card | 1 | 6900 |
| eur | expired_card | 1 | 9900 |

`data_quality`: `records_with_missing_inputs=1` (row 008), `unrecognized_failure_codes=[]`, `currencies=["usd","eur"]`, `single_item_currencies=["eur"]`.

## 5. Golden result B: the demo question

> "Find the failed payments from the last seven days with the highest recoverable revenue. Explain the reason and recommend the next safe action."

Expected plan: `intent=rank_recoverable`, `filters.failed_within_days=7`, `top_n=10` (or higher). With `FIXTURE_AS_OF`, the cutoff is `2026-10-10T12:00:00Z`.

- Excluded by the filter: **005** (failed 2026-09-20) and **006** (failed 2026-10-09T11:00Z, 8.04 days ago).
- `records_total=13`, `records_in_scope=11` (10 queued + 1 resolved: 004), `resolved=[004]`.
- **Scores and tiers are unchanged from Golden A** because `amount_norm` uses the full-dataset maximum (technical-spec §3.2), not the filtered set.

### USD queue (7-day)

| Rank | invoice_id | score | priority | recommended_action |
| ---: | --- | ---: | --- | --- |
| 1 | in_synth_001 | 85.0 | urgent | update_payment_method |
| 2 | in_synth_009 | 55.5 | high | review_manually |
| 3 | in_synth_007 | 40.4 | medium | update_payment_method |
| 4 | in_synth_002 | 33.9 | medium | wait_for_retry |
| 5 | in_synth_011 | 31.7 | medium | update_payment_method |
| 6 | in_synth_010 | 30.9 | medium | wait_for_retry |
| 7 | in_synth_008 | 29.8 | low | review_manually |
| 8 | in_synth_003 | 27.6 | low | contact_customer |
| 9 | in_synth_013 | 25.5 | low | review_manually |

EUR queue: `in_synth_012` (84.9, urgent, update_payment_method).

Metrics: usd `failed_count=9`, `affected_customers=9`, `amount_at_risk_minor=136200`, `in_recovery_minor=14800`; eur `1 / 1 / 9900 / 0`.

**Demo talking point:** the top three USD customers are 001 ($499.00, expired card), 009 ($320.00, ambiguous generic decline → manual review) and 007 ($79.00, authentication required). Row 009 has a far larger amount than 007 but a lower recovery signal. That is the "highest amount is not the same as most likely to recover" point from the spec.

## 6. Test tolerances

Compare **exactly**: rank, state, priority tier, recommended_action, confidence, counts, and all `*_minor` integers. Compare **scores** within `±0.05` and components within `±0.0015`, so a language-level rounding difference cannot fail a correct implementation. The rounding rule itself is fixed in technical-spec §3.2.

## 7. Invalid-CSV fixtures (create inline in tests)

Each must be rejected with `CSV_INVALID` and an error `details` entry naming the **column and row** (1-based data row; header is row 0):

| Case | Expectation |
| --- | --- |
| Missing required column (e.g. no `amount_due`) | `details[0].column="amount_due"`, `problem="missing_column"` |
| `amount_due` not an integer (`49.90`, `abc`, empty) | `problem="not_integer"` |
| Negative `amount_due` | `problem="negative_amount"` |
| `currency` not 3 letters | `problem="invalid_currency"` |
| `invoice_status` outside `open|paid|uncollectible|void` | `problem="invalid_status"` |
| `failed_at` not ISO-8601 | `problem="invalid_timestamp"` |
| `attempt_count` negative or non-integer | `problem="invalid_attempt_count"` |
| Duplicate `invoice_id` | `problem="duplicate_invoice_id"` |
| More than 5000 rows or larger than 1 MB | `problem="too_large"` |
| A cell starting with `=`, `+`, `-`, `@` (e.g. `=HYPERLINK(...)` in `failure_message`) | **Accepted** and treated as inert text; it must render escaped and never be evaluated or passed unquoted to code |
| Row containing a PAN-like 13 to 19 digit run in any text column | Rejected with `problem="possible_card_number"`; the raw value must not be echoed in the error |
