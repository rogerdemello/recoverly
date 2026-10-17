"""Recoverly fixed scoring library. Uploaded to the sandbox alongside generated code.

The LLM writes task-specific analysis scripts; the scoring heuristic below is NEVER
regenerated. Weights: 0.45 amount + 0.25 recovery + 0.20 urgency + 0.10 customer value.
All amounts are minor currency units. Never sum across currencies.
"""
from __future__ import annotations

import json
import math
from datetime import datetime, timezone
from typing import Any

WEIGHTS = {"amount": 0.45, "recovery": 0.25, "urgency": 0.20, "customer_value": 0.10}

# Stripe decline-code inspired recovery signals in [0, 1].
RECOVERY_SIGNALS = {
    "expired_card": 0.90,
    "incorrect_cvc": 0.60,
    "incorrect_number": 0.55,
    "incorrect_zip": 0.50,
    "authentication_required": 0.85,
    "insufficient_funds": 0.70,
    "processing_error": 0.75,
    "card_declined": 0.35,
    "generic_decline": 0.40,
    "do_not_honor": 0.20,
    "lost_card": 0.05,
    "stolen_card": 0.05,
    "revocation_of_all_authorizations": 0.05,
    "withdrawal_count_limit_exceeded": 0.30,
}
DEFAULT_RECOVERY_SIGNAL = 0.35

COLLECTIBLE = {"open"}
NON_COLLECTIBLE = {"paid", "void", "uncollectible"}
ACTION_STATES = {"action_needed", "failed", "unknown"}
RECOVERED_STATE = "recovered"
NOT_RECOVERED_STATE = "not_recovered"


def parse_ts(value: Any) -> datetime | None:
    if not value or not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def recovery_signal(failure_code: str | None) -> tuple[float, list[str]]:
    if not failure_code:
        return DEFAULT_RECOVERY_SIGNAL, ["missing failure_code; using default recovery signal"]
    score = RECOVERY_SIGNALS.get(failure_code.lower())
    if score is None:
        return DEFAULT_RECOVERY_SIGNAL, [f"unknown failure_code {failure_code!r}; using default recovery signal"]
    return score, []


def urgency_signal(row: dict[str, Any], now: datetime) -> tuple[float, list[str]]:
    notes: list[str] = []
    status = (row.get("invoice_status") or "").lower()
    state = (row.get("recovery_state") or "").lower()
    attempts = int(row.get("attempt_count") or 0)

    if status in NON_COLLECTIBLE:
        return 0.0, [f"invoice_status={status}; not collectible"]
    if status not in COLLECTIBLE:
        notes.append(f"unexpected invoice_status={status!r}")

    score = 0.25
    failed_at = parse_ts(row.get("failed_at"))
    if failed_at is None:
        notes.append("missing or invalid failed_at")
        score = max(score - 0.1, 0.0)
    else:
        age_days = max((now - failed_at).total_seconds() / 86400.0, 0.0)
        if age_days >= 14:
            score += 0.30
            notes.append(f"failed {age_days:.1f} days ago")
        elif age_days >= 7:
            score += 0.20
            notes.append(f"failed {age_days:.1f} days ago")
        elif age_days >= 2:
            score += 0.10

    retry = parse_ts(row.get("next_payment_attempt"))
    if retry is not None and retry > now:
        score -= 0.25
        notes.append("retry already scheduled")
    elif row.get("next_payment_attempt") is None:
        score += 0.15
        notes.append("no retry scheduled")

    if attempts >= 3:
        score += 0.15
        notes.append(f"{attempts} attempts")
    elif attempts == 2:
        score += 0.05

    if state in ACTION_STATES:
        score += 0.10
    if state == RECOVERED_STATE or status == "paid":
        return 0.0, ["already recovered"]
    if state == NOT_RECOVERED_STATE or status in {"uncollectible", "void"}:
        return 0.0, [f"recovery_state={state or 'unknown'} / invoice_status={status}; closed"]

    return max(0.0, min(1.0, score)), notes


def customer_value_signal(row: dict[str, Any]) -> tuple[float, list[str]]:
    notes: list[str] = []
    ltv = row.get("customer_lifetime_value_minor")
    created = parse_ts(row.get("customer_created_at"))
    parts: list[float] = []
    if ltv is None:
        notes.append("missing customer_lifetime_value_minor")
    else:
        # log scale: 10 USD ~ 0.4, 1k USD ~ 0.7, 10k+ USD ~ 0.9+
        parts.append(min(1.0, math.log10(max(float(ltv), 1.0) / 100.0 + 1.0) / 4.0))
    if created is None:
        notes.append("missing customer_created_at")
    else:
        tenure_days = max((datetime.now(timezone.utc) - created).total_seconds() / 86400.0, 0.0)
        parts.append(min(1.0, tenure_days / 1460.0))  # saturate at ~4 years
    if not parts:
        return 0.3, notes
    return sum(parts) / len(parts), notes


def score_row(row: dict[str, Any], amount_min: float, amount_max: float, now: datetime) -> dict[str, Any]:
    missing: list[str] = []
    for req in ("customer_id", "invoice_id", "amount_due", "currency", "failure_code", "invoice_status"):
        if row.get(req) in (None, ""):
            missing.append(req)

    amount = float(row.get("amount_due") or 0)
    if amount_max > amount_min:
        amount_norm = (amount - amount_min) / (amount_max - amount_min)
    else:
        amount_norm = 1.0 if amount > 0 else 0.0

    rec, rec_notes = recovery_signal(row.get("failure_code"))
    urg, urg_notes = urgency_signal(row, now)
    val, val_notes = customer_value_signal(row)

    score = (
        amount_norm * WEIGHTS["amount"]
        + rec * WEIGHTS["recovery"]
        + urg * WEIGHTS["urgency"]
        + val * WEIGHTS["customer_value"]
    )

    if "failure_code" in missing:
        score *= 0.85
    if "amount_due" in missing:
        score *= 0.5

    confidence = 1.0
    if missing:
        confidence -= 0.15 * len(missing)
    if any("missing" in n or "invalid" in n or "unknown" in n or "default" in n for n in rec_notes + urg_notes + val_notes):
        confidence -= 0.1
    confidence = max(0.1, min(1.0, confidence))

    if score >= 0.75:
        priority = "urgent"
    elif score >= 0.55:
        priority = "high"
    elif score >= 0.35:
        priority = "medium"
    else:
        priority = "low"

    return {
        "priority_score": round(score, 4),
        "priority": priority,
        "confidence": round(confidence, 4),
        "score_components": {
            "amount": round(amount_norm, 4),
            "recovery": round(rec, 4),
            "urgency": round(urg, 4),
            "customer_value": round(val, 4),
        },
        "missing_fields": missing,
        "notes": rec_notes + urg_notes + val_notes,
    }


def recommend_action(row: dict[str, Any], scored: dict[str, Any]) -> str:
    status = (row.get("invoice_status") or "").lower()
    code = (row.get("failure_code") or "").lower()
    if status in {"paid"}:
        return "do_not_pursue"
    if status in {"void", "uncollectible"}:
        return "do_not_pursue"
    if code in {"lost_card", "stolen_card", "revocation_of_all_authorizations"}:
        return "contact_customer"
    if code in {"expired_card", "incorrect_cvc", "incorrect_number", "incorrect_zip", "authentication_required"}:
        return "update_payment_method"
    retry = parse_ts(row.get("next_payment_attempt"))
    if retry is not None and retry > datetime.now(timezone.utc):
        return "wait_for_retry"
    if scored["priority"] in {"urgent", "high"} and scored["confidence"] >= 0.6:
        return "contact_customer"
    if scored["confidence"] < 0.5:
        return "review_manually"
    return "review_manually"


def load_records(path: str = "data.json") -> list[dict[str, Any]]:
    with open(path, "r", encoding="utf-8") as f:
        payload = json.load(f)
    if isinstance(payload, dict) and isinstance(payload.get("records"), list):
        return payload["records"]
    if isinstance(payload, list):
        return payload
    raise ValueError("data.json must be a list of records or an object with a records list")


def prepare_dataset(records: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], dict[str, float]]:
    """Per-currency amount ranges for normalization. Never normalize across currencies."""
    by_currency: dict[str, list[float]] = {}
    for r in records:
        cur = (r.get("currency") or "usd").lower()
        try:
            amt = float(r.get("amount_due") or 0)
        except (TypeError, ValueError):
            continue
        by_currency.setdefault(cur, []).append(amt)
    ranges = {
        cur: (min(v) if v else 0.0, max(v) if v else 0.0)
        for cur, v in by_currency.items()
    }
    return records, {f"{cur}_min": r[0] for cur, r in ranges.items()} | {f"{cur}_max": r[1] for cur, r in ranges.items()}


def rank_records(records: list[dict[str, Any]], now: datetime | None = None) -> list[dict[str, Any]]:
    now = now or datetime.now(timezone.utc)
    ranges: dict[str, tuple[float, float]] = {}
    for r in records:
        cur = (r.get("currency") or "usd").lower()
        try:
            amt = float(r.get("amount_due") or 0)
        except (TypeError, ValueError):
            amt = 0.0
        lo, hi = ranges.get(cur, (amt, amt))
        ranges[cur] = (min(lo, amt), max(hi, amt))

    ranked: list[dict[str, Any]] = []
    for row in records:
        cur = (row.get("currency") or "usd").lower()
        lo, hi = ranges.get(cur, (0.0, 0.0))
        scored = score_row(row, lo, hi, now)
        ranked.append(
            {
                **row,
                **scored,
                "recommended_action": recommend_action(row, scored),
                "source_tags": {
                    "amount_due": "stripe_fact",
                    "failure_code": "stripe_fact",
                    "invoice_status": "stripe_fact",
                    "attempt_count": "stripe_fact",
                    "next_payment_attempt": "stripe_fact",
                    "customer_lifetime_value_minor": "stripe_fact",
                    "priority_score": "agent_inference",
                    "priority": "agent_inference",
                    "recommended_action": "agent_inference",
                    "confidence": "agent_inference",
                },
            }
        )
    ranked.sort(key=lambda x: x["priority_score"], reverse=True)
    for i, item in enumerate(ranked, start=1):
        item["rank"] = i
    return ranked


def summarize(records: list[dict[str, Any]]) -> dict[str, Any]:
    """Aggregate metrics from records (raw or ranked — same rows)."""
    by_currency: dict[str, dict[str, Any]] = {}
    for r in records:
        cur = (r.get("currency") or "usd").lower()
        bucket = by_currency.setdefault(
            cur,
            {"amount_at_risk_minor": 0, "failed_count": 0, "customer_ids": set()},
        )
        try:
            bucket["amount_at_risk_minor"] += int(float(r.get("amount_due") or 0))
        except (TypeError, ValueError):
            pass
        bucket["failed_count"] += 1
        if r.get("customer_id"):
            bucket["customer_ids"].add(r["customer_id"])

    metrics_by_currency = {
        cur: {
            "amount_at_risk_minor": b["amount_at_risk_minor"],
            "failed_count": b["failed_count"],
            "customer_count": len(b["customer_ids"]),
        }
        for cur, b in by_currency.items()
    }

    by_failure_code: dict[str, dict[str, int]] = {}
    by_recovery_status: dict[str, dict[str, int]] = {}
    for r in records:
        code = r.get("failure_code") or "unknown"
        state = r.get("recovery_state") or "unknown"
        cur = (r.get("currency") or "usd").lower()
        try:
            amt = int(float(r.get("amount_due") or 0))
        except (TypeError, ValueError):
            amt = 0
        for bucket, key in ((by_failure_code, code), (by_recovery_status, state)):
            slot = bucket.setdefault(key, {"count": 0, "amount_by_currency": {}})
            slot["count"] += 1
            slot["amount_by_currency"][cur] = slot["amount_by_currency"].get(cur, 0) + amt

    return {
        "total_failed_count": len(records),
        "total_customer_count": len({r.get("customer_id") for r in records if r.get("customer_id")}),
        "by_currency": metrics_by_currency,
        "by_failure_code": by_failure_code,
        "by_recovery_status": by_recovery_status,
    }


def data_quality(records: list[dict[str, Any]]) -> dict[str, Any]:
    required = ["customer_id", "invoice_id", "amount_due", "currency", "failure_code", "invoice_status", "failed_at"]
    partial = 0
    missing_counts: dict[str, int] = {}
    for r in records:
        row_missing = [f for f in required if r.get(f) in (None, "")]
        if row_missing:
            partial += 1
            for f in row_missing:
                missing_counts[f] = missing_counts.get(f, 0) + 1
    notes = []
    if partial:
        notes.append(f"{partial} of {len(records)} records missing at least one required field")
    emails = sum(1 for r in records if not r.get("customer_email"))
    if emails:
        notes.append(f"{emails} records have no customer_email (masking or import gap)")
    return {
        "required_fields": required,
        "partial_rows": partial,
        "missing_field_counts": missing_counts,
        "notes": notes,
    }
