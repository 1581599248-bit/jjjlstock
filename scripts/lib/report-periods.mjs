const QUARTER_ENDS = [[3, 31], [6, 30], [9, 30], [12, 31]];

export const isReportPeriod = (value) => /^\d{4}-(03-31|06-30|09-30|12-31)$/.test(value);
export const sortPeriodsDesc = (periods) => [...new Set(periods.filter(isReportPeriod))].sort((a, b) => b.localeCompare(a));

export function completedReportPeriods(now = new Date(), firstYear = 2020) {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const periods = [];
  for (let year = firstYear; year <= today.getUTCFullYear(); year += 1) {
    for (const [month, day] of QUARTER_ENDS) {
      const end = new Date(Date.UTC(year, month - 1, day));
      if (end <= today) periods.push(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
    }
  }
  return periods;
}

export function nextUnpublishedPeriod(publishedPeriods, now = new Date()) {
  const published = sortPeriodsDesc(publishedPeriods);
  const latest = published[0] ?? "0000-00-00";
  return completedReportPeriods(now, Math.max(2020, Number(latest.slice(0, 4)) || 2020))
    .filter((period) => period > latest)
    .sort()[0] ?? null;
}

export function previousPublishedPeriod(publishedPeriods, period) {
  return sortPeriodsDesc(publishedPeriods).find((item) => item < period) ?? null;
}
