export type FormatMessageTimeOptions = {
  /** The moment "today" is judged from. Default: the current time. */
  now?: Date;
  /** IANA zone. Default: the runtime's zone. */
  timeZone?: string;
  /** Default `en-GB`. The UI is English-only; a fixed locale keeps output deterministic. */
  locale?: string;
};

/**
 * Month labels are our own. `en-GB` abbreviates September as "Sept" in current
 * ICU data and may change again; the panel shows "16 Sep".
 */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type DateParts = { day: string; month: string; year: string; hour: string; minute: string };

function partsOf(format: Intl.DateTimeFormat, date: Date): DateParts {
  const parts: Record<string, string> = {};
  for (const { type, value } of format.formatToParts(date)) parts[type] = value;
  return {
    day: parts.day,
    month: parts.month,
    year: parts.year,
    hour: parts.hour,
    minute: parts.minute,
  };
}

/**
 * A message's local time for display (room-panel design §6): `17:03` today,
 * `16 Sep 17:03` on another day of this year, `16 Sep 2025 17:03` in another
 * year. Days and years are compared in the target zone, never in UTC. `Date`
 * drops the microseconds of `createdAt`, which is fine for display; ordering
 * uses `compareCreatedAtId`. An unparseable input gives "".
 */
export function formatMessageTime(iso: string, opts: FormatMessageTimeOptions = {}): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const format = new Intl.DateTimeFormat(opts.locale ?? "en-GB", {
    timeZone: opts.timeZone,
    day: "numeric",
    month: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const at = partsOf(format, date);
  const now = partsOf(format, opts.now ?? new Date());
  const time = `${at.hour}:${at.minute}`;
  const dayAndMonth = `${at.day} ${MONTHS[Number(at.month) - 1]}`;
  if (at.year !== now.year) return `${dayAndMonth} ${at.year} ${time}`;
  if (at.month !== now.month || at.day !== now.day) return `${dayAndMonth} ${time}`;
  return time;
}
