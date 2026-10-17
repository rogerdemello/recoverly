import json
import recoverly_lib as lib

PLAN = json.loads(r'''{"intent":"rank_recoverable","filters":{"failed_within_days":7},"group_by":[],"top_n":10,"then_draft":false,"explanation":"Rank unresolved failed payments from the last 7 days by recovery priority, using failure code, retry status, amount, age and customer tenure.","fields_used":["failed_at","amount_due","currency","failure_code","next_payment_attempt","attempt_count","invoice_status","customer_created_at"]}''')

TIERS = {"low": 0, "medium": 1, "high": 2, "urgent": 3}


def keep(item, f):
    """Apply every filter in the plan; absent filters keep everything."""
    if "failed_within_days" in f and item["days_since_failure"] > f["failed_within_days"]:
        return False
    if "min_amount_minor" in f and item["amount_minor"] < f["min_amount_minor"]:
        return False
    if "currency" in f and item["currency"] != f["currency"]:
        return False
    if "states" in f and item["state"] not in f["states"]:
        return False
    if "failure_codes" in f and item["failure_code"] not in f["failure_codes"]:
        return False
    if "priority_at_least" in f:
        if item["priority"] is None or TIERS[item["priority"]] < TIERS[f["priority_at_least"]]:
            return False
    return True


as_of, records = lib.load()
ctx = lib.build_context(records, as_of)  # scores use the FULL dataset's maximum amounts
items = [lib.enrich(r, ctx) for r in records]
scoped = [it for it in items if keep(it, PLAN["filters"])]
queues, truncated = lib.rank_queues(scoped, PLAN["top_n"])
result = lib.build_result(PLAN, as_of, len(records), scoped, queues, truncated, [])
print(json.dumps(result))
