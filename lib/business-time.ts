type DateTimeParts = { year: number; month: number; day: number; hour: number; minute: number };

function partsAt(instant: Date, timeZone: string): DateTimeParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
  };
}

function encodeLocal(parts: DateTimeParts): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

function utcMillis(parts: DateTimeParts): number {
  const date = new Date(0);
  date.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  date.setUTCHours(parts.hour, parts.minute, 0, 0);
  return date.getTime();
}

export function formatBusinessDateTime(instant: Date, timeZone: string): string {
  return encodeLocal(partsAt(instant, timeZone));
}

/** Parse a datetime-local value as wall-clock time in an IANA business timezone. */
export function parseBusinessDateTime(value: string, timeZone: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error("Choose a valid business date and time.");
  const desired: DateTimeParts = {
    year: Number(match[1]), month: Number(match[2]), day: Number(match[3]),
    hour: Number(match[4]), minute: Number(match[5]),
  };
  const desiredMillis = utcMillis(desired);
  if (encodeLocal(partsAt(new Date(desiredMillis), "UTC")) !== value) {
    throw new Error("Choose a valid business date and time.");
  }

  // Sample offsets around the requested wall time. This also handles DST transitions;
  // ambiguous repeated times resolve deterministically to the earlier matching instant.
  const offsets = new Set<number>();
  for (const delta of [-36, 0, 36]) {
    const sample = new Date(desiredMillis + delta * 60 * 60 * 1000);
    offsets.add(utcMillis(partsAt(sample, timeZone)) - sample.getTime());
  }
  const candidates = Array.from(offsets)
    .map((offset) => new Date(desiredMillis - offset))
    .filter((candidate) => formatBusinessDateTime(candidate, timeZone) === value)
    .sort((a, b) => a.getTime() - b.getTime());
  if (!candidates.length) {
    throw new Error("That local time does not exist in the business timezone because of a clock change. Choose another time.");
  }
  return candidates[0].toISOString();
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}
