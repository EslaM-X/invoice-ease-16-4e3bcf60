import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chatDayKey, formatChatDayLabel } from "@/lib/format-chat-day";

/**
 * Timezone/DST tests for the chat day helpers.
 *
 * These tests exercise real edge cases:
 *  - A timestamp near midnight UTC that maps to a different calendar day
 *    depending on the viewer's timezone.
 *  - The DST transitions in America/New_York (spring forward + fall back).
 *    A naive `(nowMs - thenMs) / 86_400_000` would produce fractional days
 *    on those weekends and mislabel "Yesterday" as "Today" or vice-versa.
 *  - Timezones east of UTC (Africa/Cairo, Asia/Tokyo) where a UTC "yesterday"
 *    can already be "today" locally.
 */
describe("chatDayKey", () => {
  it("returns YYYY-MM-DD in the target timezone", () => {
    // 2024-03-15 23:30 UTC — still 2024-03-15 in London but 2024-03-16 in Tokyo.
    const iso = "2024-03-15T23:30:00Z";
    expect(chatDayKey(iso, "Europe/London")).toBe("2024-03-15");
    expect(chatDayKey(iso, "Asia/Tokyo")).toBe("2024-03-16");
    // Los Angeles is still 16:30 the same day.
    expect(chatDayKey(iso, "America/Los_Angeles")).toBe("2024-03-15");
  });

  it("handles pre-1970 and future dates without wrap-around", () => {
    expect(chatDayKey("1965-06-01T12:00:00Z", "UTC")).toBe("1965-06-01");
    expect(chatDayKey("2099-12-31T23:00:00Z", "UTC")).toBe("2099-12-31");
  });

  it("returns 'unknown' for invalid input", () => {
    expect(chatDayKey("not-a-date")).toBe("unknown");
    // @ts-expect-error deliberately wrong shape
    expect(chatDayKey(null)).toBe("unknown");
  });

  it("is stable across the US spring-forward DST boundary", () => {
    // 2024-03-10 02:00 local time was skipped in America/New_York.
    // A message posted at 06:30 UTC on that Sunday is still the same
    // local day as one posted at 23:00 UTC the day before minus a few hours,
    // but importantly the *key* for a given local day is stable.
    const beforeSpring = "2024-03-10T05:00:00Z"; // 01:00 EST (before jump)
    const afterSpring  = "2024-03-10T15:00:00Z"; // 11:00 EDT (after jump)
    expect(chatDayKey(beforeSpring, "America/New_York")).toBe("2024-03-10");
    expect(chatDayKey(afterSpring,  "America/New_York")).toBe("2024-03-10");
  });
});

describe("formatChatDayLabel", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("labels Today / Yesterday in the caller's timezone (Cairo)", () => {
    // Now: 2024-06-15 09:00 UTC = 11:00 in Africa/Cairo.
    vi.setSystemTime(new Date("2024-06-15T09:00:00Z"));
    const today = "2024-06-15T04:00:00Z";     // 06:00 Cairo — today
    const yesterday = "2024-06-14T20:00:00Z"; // 22:00 Cairo — yesterday
    expect(formatChatDayLabel(today,     "en", "Africa/Cairo")).toBe("Today");
    expect(formatChatDayLabel(yesterday, "en", "Africa/Cairo")).toBe("Yesterday");
    expect(formatChatDayLabel(today,     "ar", "Africa/Cairo")).toBe("اليوم");
    expect(formatChatDayLabel(yesterday, "ar", "Africa/Cairo")).toBe("أمس");
  });

  it("respects timezone when 'today' UTC is already 'tomorrow' in Tokyo", () => {
    // Now: 2024-06-14 23:00 UTC = 2024-06-15 08:00 in Tokyo.
    vi.setSystemTime(new Date("2024-06-14T23:00:00Z"));
    const cairoNoonUtc = "2024-06-14T09:00:00Z"; // Tokyo: 2024-06-14 18:00 — yesterday
    const nowIsh       = "2024-06-14T22:30:00Z"; // Tokyo: 2024-06-15 07:30 — today
    expect(formatChatDayLabel(cairoNoonUtc, "en", "Asia/Tokyo")).toBe("Yesterday");
    expect(formatChatDayLabel(nowIsh,       "en", "Asia/Tokyo")).toBe("Today");
  });

  it("stays correct across the US spring-forward DST boundary", () => {
    // Now: Monday 2024-03-11 15:00 UTC = 11:00 EDT.
    vi.setSystemTime(new Date("2024-03-11T15:00:00Z"));
    // A message from Sunday 22:00 EDT (after the jump) — still yesterday.
    const sundayAfterJump = "2024-03-11T02:00:00Z";
    // A message from Sunday 01:30 EST (before the jump) — still yesterday.
    const sundayBeforeJump = "2024-03-10T06:30:00Z";
    expect(formatChatDayLabel(sundayAfterJump,  "en", "America/New_York")).toBe("Yesterday");
    expect(formatChatDayLabel(sundayBeforeJump, "en", "America/New_York")).toBe("Yesterday");
  });

  it("stays correct across the US fall-back DST boundary", () => {
    // On 2024-11-03, America/New_York rewinds 02:00 EDT back to 01:00 EST,
    // so that Sunday has 25 hours. Naive ms diffs would break "Yesterday".
    // Now: Monday 2024-11-04 15:00 UTC = 10:00 EST.
    vi.setSystemTime(new Date("2024-11-04T15:00:00Z"));
    const sundayEarly = "2024-11-03T04:30:00Z"; // 00:30 EDT — yesterday
    const sundayLate  = "2024-11-03T23:30:00Z"; // 18:30 EST — yesterday
    expect(formatChatDayLabel(sundayEarly, "en", "America/New_York")).toBe("Yesterday");
    expect(formatChatDayLabel(sundayLate,  "en", "America/New_York")).toBe("Yesterday");
  });

  it("returns a weekday name for messages 2..6 days old", () => {
    // Now: Sunday 2024-06-16 12:00 UTC.
    vi.setSystemTime(new Date("2024-06-16T12:00:00Z"));
    // 3 days ago = Thursday 2024-06-13.
    const threeDaysAgo = "2024-06-13T12:00:00Z";
    const label = formatChatDayLabel(threeDaysAgo, "en", "UTC");
    expect(label).toBe("Thursday");
    const labelAr = formatChatDayLabel(threeDaysAgo, "ar", "UTC");
    // Arabic weekday name — just assert it's a non-empty string that isn't
    // "اليوم"/"أمس", since the exact word depends on the ICU version.
    expect(labelAr).not.toBe("اليوم");
    expect(labelAr).not.toBe("أمس");
    expect(labelAr.length).toBeGreaterThan(0);
  });

  it("returns a full date for messages older than a week", () => {
    vi.setSystemTime(new Date("2024-06-16T12:00:00Z"));
    const old = "2024-05-01T12:00:00Z";
    const label = formatChatDayLabel(old, "en", "UTC");
    expect(label).toMatch(/2024/);
    expect(label).toMatch(/May/i);
  });

  it("returns empty string for invalid input", () => {
    expect(formatChatDayLabel("not-a-date")).toBe("");
  });
});
