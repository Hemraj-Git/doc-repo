import { APP_TIMEZONE } from "@/lib/config"

const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: APP_TIMEZONE })
const dateTimeFmt = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: APP_TIMEZONE,
})

/** 20 Oct 2026 — in the institute's timezone. */
export const formatDate = (iso: string) => dateFmt.format(new Date(iso))
/** 20 Oct 2026, 14:05 — in the institute's timezone. */
export const formatDateTime = (iso: string) => dateTimeFmt.format(new Date(iso))

const isoDateFmt = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: APP_TIMEZONE })
/** Today's date (YYYY-MM-DD) in the institute's timezone. */
export const todayIso = () => isoDateFmt.format(new Date())
