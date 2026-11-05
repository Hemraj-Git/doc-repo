// Client-safe mirror of the database's academic calendar (academic_year_of / period_for):
// the academic year starts on the 1st of a configured month; Semester 1 is its first six
// months and Semester 2 the last six.

export type Semester = { key: string; label: string; academicYear: string; semester: 1 | 2 }

function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function academicYearLabel(startYear: number) {
  return `${startYear}–${String((startYear + 1) % 100).padStart(2, "0")}`
}

/** The half of the year a date falls in ("Semester 1, 2026–27", or "H1 2026–27" with word "H"). */
export function semesterOf(iso: string, startMonth: number, word: "Semester" | "H" = "Semester"): Semester {
  const [y, m] = iso.split("-").map(Number) as [number, number]
  const startYear = m < startMonth ? y - 1 : y
  const monthsIn = (y - startYear) * 12 + (m - startMonth)
  const semester = monthsIn < 6 ? 1 : 2
  const academicYear = startMonth === 1 ? String(startYear) : academicYearLabel(startYear)
  const label = word === "H" ? `H${semester} ${academicYear}` : `Semester ${semester}, ${academicYear}`
  return { key: `${academicYear}/S${semester}`, label, academicYear, semester }
}

/** Semester a period is filed under: weeks by their Thursday, everything else by its first day. */
export function semesterOfPeriod(recurrence: string, periodStart: string, startMonth: number, word: "Semester" | "H" = "Semester") {
  return semesterOf(recurrence === "weekly" ? addDays(periodStart, 3) : periodStart, startMonth, word)
}

/** Short column heading for a period: "W03", "Oct", "S1", "2026–27". */
export function shortPeriodLabel(recurrence: string, key: string, start: string) {
  if (recurrence === "weekly") return key.split("/").pop() ?? key
  if (recurrence === "monthly") return new Date(`${start}T00:00:00Z`).toLocaleString("en-GB", { month: "short", timeZone: "UTC" })
  if (recurrence === "semester" || recurrence === "quarterly" || recurrence === "half_yearly") return key.split("/").pop() ?? key
  return key
}
