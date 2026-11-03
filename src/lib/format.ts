// Display formatting shared across the hub (en-AU, the viewer's local time zone).

import type { PropertyProfile } from "../../shared/types";

const LOCALE = "en-AU";

const timeFormat = new Intl.DateTimeFormat(LOCALE, { hour: "numeric", minute: "2-digit" });
const clockFormat = new Intl.DateTimeFormat(LOCALE, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});
const dayFormat = new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "short" });
const dayYearFormat = new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "short", year: "numeric" });

function toDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** "7:02 am" */
export function formatTime(iso: string | null | undefined): string {
  const date = toDate(iso);
  return date ? timeFormat.format(date) : "";
}

/** "07:02:13", for the activity terminal. */
export function formatClock(iso: string | null | undefined): string {
  const date = toDate(iso);
  return date ? clockFormat.format(date) : "--:--:--";
}

/** "Today, 7:02 am" / "3 Nov, 7:02 am" / "3 Nov 2025, 7:02 am" */
export function formatDateTime(iso: string | null | undefined): string {
  const date = toDate(iso);
  if (!date) return "";
  const now = new Date();
  const time = timeFormat.format(date);
  if (sameDay(date, now)) return `Today, ${time}`;
  const day = date.getFullYear() === now.getFullYear() ? dayFormat.format(date) : dayYearFormat.format(date);
  return `${day}, ${time}`;
}

/** "3 Nov 2026" */
export function formatDate(iso: string | null | undefined): string {
  const date = toDate(iso);
  return date ? dayYearFormat.format(date) : "";
}

/** "just now", "5m ago", "3h ago", "2d ago", then a date. */
export function timeAgo(iso: string | null | undefined, now: number = Date.now()): string {
  const date = toDate(iso);
  if (!date) return "";
  const seconds = Math.max(0, Math.round((now - date.getTime()) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(iso);
}

/** "12s", "3m 04s", "1h 02m" */
export function formatElapsed(sinceIso: string | null | undefined, now: number = Date.now()): string {
  const date = toDate(sinceIso);
  if (!date) return "";
  const total = Math.max(0, Math.floor((now - date.getTime()) / 1000));
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes}m ${String(total % 60).padStart(2, "0")}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

export function initials(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts.at(-1)?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

/** "SP 26707 · Claremont" */
export function propertyLabel(profile: Pick<PropertyProfile, "spNumber" | "suburb">): string {
  return `SP ${profile.spNumber} · ${profile.suburb}`;
}

/** "34 Davies Road, Claremont WA 6010" */
export function propertyAddress(profile: PropertyProfile): string {
  const tail = [profile.suburb, profile.state, profile.postcode].filter(Boolean).join(" ");
  return profile.street ? `${profile.street}, ${tail}` : tail;
}

/** Fallback label for a property id when its profile is not loaded: "sp-26707" → "SP 26707". */
export function labelFromId(propertyId: string): string {
  const match = /^sp-(\d+)$/i.exec(propertyId);
  return match ? `SP ${match[1]}` : propertyId;
}

/** Converts an ISO timestamp to the value of an <input type="date">. */
export function toDateInput(iso: string | null | undefined): string {
  const date = toDate(iso);
  if (!date) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Converts an <input type="date"> value (local day) to an ISO timestamp at 5pm local time. */
export function fromDateInput(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  return new Date(year, month - 1, day, 17, 0, 0).toISOString();
}
