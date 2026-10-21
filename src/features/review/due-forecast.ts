// Cumulative cutoffs: midnight after each target day, in the user's time zone.
export function upcomingDueDays(now = new Date()) {
  const days = [1, 2, 3, 4].map(
    (offset) =>
      new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset),
  );
  return {
    dates: days
      .slice(0, 3)
      .map(
        (day) =>
          `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`,
      ),
    boundaries: days.slice(1).map((day) => day.toISOString()),
  };
}
