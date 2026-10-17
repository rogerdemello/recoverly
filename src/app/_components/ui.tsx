"use client";

import { useEffect, useRef, type ReactNode } from "react";
import type { Priority } from "@/lib/domain/schemas";

export function PriorityBadge({ priority }: { priority: Priority }) {
  return <span className={`badge b-${priority}`}>{priority.toUpperCase()}</span>;
}

export function ConfidenceBadge({ confidence }: { confidence: "high" | "medium" | "low" }) {
  const cls = confidence === "high" ? "b-ok" : confidence === "medium" ? "b-warn" : "b-bad";
  return <span className={`badge ${cls}`}>{confidence} confidence</span>;
}

/** Accessible side drawer / modal shell: Escape closes, focus moves in on open and returns on close. */
export function Overlay({
  title,
  onClose,
  variant,
  children,
  labelledBy,
}: {
  title: string;
  onClose: () => void;
  variant: "drawer" | "modal";
  children: ReactNode;
  labelledBy: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [onClose]);
  return (
    <>
      <div className="overlay" onClick={onClose} aria-hidden="true" />
      <div
        ref={ref}
        className={variant}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-label={title}
        tabIndex={-1}
      >
        {children}
      </div>
    </>
  );
}

/** Snapshot times are shown in UTC so the fixed demo time reads the same everywhere. */
export function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} UTC`;
}
