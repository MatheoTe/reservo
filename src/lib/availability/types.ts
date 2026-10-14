/** ISO weekday: 1 = Monday ... 7 = Sunday (matches Temporal.PlainDate#dayOfWeek). */
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** A recurring wall-clock window on a weekday, e.g. Mon 09:00-13:00. */
export interface WeeklyWindow {
  weekday: IsoWeekday;
  /** "HH:MM" */
  start: string;
  /** "HH:MM", may be "24:00" */
  end: string;
}

/** Wall-clock window without a weekday, used by date overrides. */
export interface WallWindow {
  start: string;
  end: string;
}

/**
 * Replaces the weekly schedule (hours AND breaks) for one calendar date.
 * An empty `windows` array means the staff member is off that day.
 */
export interface DateOverride {
  /** ISO date "YYYY-MM-DD" in the organization's time zone. */
  date: string;
  windows: WallWindow[];
}

/** Absolute time range in epoch milliseconds, half-open. */
export interface InstantRange {
  start: number;
  end: number;
}

export interface StaffSchedule {
  staffId: string;
  weeklyHours: WeeklyWindow[];
  weeklyBreaks: WeeklyWindow[];
  dateOverrides: DateOverride[];
  /** Vacations, sick leave, a dentist appointment... absolute ranges. */
  timeOff: InstantRange[];
  /**
   * Ranges already taken by existing bookings, *including their buffers*
   * (this is exactly the range protected by the DB exclusion constraint).
   */
  busy: InstantRange[];
}

export interface ServiceRules {
  durationMinutes: number;
  /** Prep time that must be free before the appointment (may fall outside hours). */
  bufferBeforeMinutes: number;
  /** Cleanup time that must be free after the appointment (may fall outside hours). */
  bufferAfterMinutes: number;
}

export interface BookingPolicy {
  /** Distance between candidate start times on the wall clock, e.g. 15. */
  slotIntervalMinutes: number;
  /** Earliest bookable start relative to now. */
  minNoticeMinutes: number;
  /** Latest bookable start relative to now. */
  maxAdvanceDays: number;
}

export interface AvailabilityQuery {
  /** IANA zone of the organization. All wall times are interpreted in it. */
  timeZone: string;
  /** Inclusive local dates (org time zone), "YYYY-MM-DD". */
  from: string;
  to: string;
  /** Current instant, injected so the engine stays pure and testable. */
  now: number;
  service: ServiceRules;
  policy: BookingPolicy;
  staff: StaffSchedule[];
  /** Org-wide closed dates (public holidays), "YYYY-MM-DD" in org zone. */
  closedDates?: string[];
}

export interface Slot {
  staffId: string;
  /** Appointment start, epoch ms. */
  start: number;
  /** Appointment end (start + duration), epoch ms. Buffers are not included. */
  end: number;
}

/** A start time offered to customers when they pick "any available staff". */
export interface PooledSlot {
  start: number;
  end: number;
  staffIds: string[];
}
