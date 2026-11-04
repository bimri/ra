// The part of the day where the person is, so Ra's words follow their clock: one rule
// for the phone (its own hour) and the Mind (the offset the phone sends with every Ray).

export type Daypart = "morning" | "afternoon" | "evening" | "night";

/** 5–12 morning, 12–17 afternoon, 17–22 evening, 22–5 night. */
export function daypart(hour: number): Daypart {
  return hour >= 5 && hour < 12 ? "morning" : hour >= 12 && hour < 17 ? "afternoon" : hour >= 17 && hour < 22 ? "evening" : "night";
}

/** "today" by day, "tonight" from the evening on. */
export function todayOrTonight(hour: number): "today" | "tonight" {
  const p = daypart(hour);
  return p === "evening" || p === "night" ? "tonight" : "today";
}
