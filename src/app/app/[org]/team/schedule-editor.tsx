"use client";

import { useState } from "react";

import { useAction } from "@/components/use-action";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Avatar } from "@/components/ui/misc";
import { saveScheduleAction } from "@/server/actions/team";

interface Window {
  weekday: number;
  start: string;
  end: string;
}

interface DayState {
  enabled: boolean;
  start: string;
  end: string;
  breakStart: string;
  breakEnd: string;
}

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/**
 * Edits the common case - one shift and an optional break per day - and maps
 * it to the general model (any number of windows + breaks) the engine uses.
 */
function toState(hours: Window[], breaks: Window[]): DayState[] {
  return DAYS.map((_, i) => {
    const weekday = i + 1;
    const dayHours = hours.filter((h) => h.weekday === weekday);
    const dayBreak = breaks.find((b) => b.weekday === weekday);
    return {
      enabled: dayHours.length > 0,
      start: dayHours[0]?.start ?? "09:00",
      end: dayHours.at(-1)?.end ?? "17:00",
      breakStart: dayBreak?.start ?? "",
      breakEnd: dayBreak?.end ?? "",
    };
  });
}

export function ScheduleEditor({
  orgSlug,
  staff,
  initialHours,
  initialBreaks,
}: {
  orgSlug: string;
  staff: { id: string; name: string; color: string };
  initialHours: Window[];
  initialBreaks: Window[];
}) {
  const [days, setDays] = useState(() => toState(initialHours, initialBreaks));
  const { run, pending } = useAction({ success: `Saved ${staff.name}'s hours` });
  const update = (i: number, patch: Partial<DayState>) =>
    setDays((d) => d.map((day, j) => (j === i ? { ...day, ...patch } : day)));

  function save() {
    const hours: Window[] = [];
    const breaks: Window[] = [];
    days.forEach((d, i) => {
      if (!d.enabled) return;
      hours.push({ weekday: i + 1, start: d.start, end: d.end });
      if (d.breakStart && d.breakEnd)
        breaks.push({ weekday: i + 1, start: d.breakStart, end: d.breakEnd });
    });
    run(() => saveScheduleAction(orgSlug, { staffId: staff.id, hours, breaks }));
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-3">
          <Avatar name={staff.name} color={staff.color} /> {staff.name}
        </CardTitle>
        <Button size="sm" onClick={save} disabled={pending}>
          {pending ? "Saving..." : "Save hours"}
        </Button>
      </CardHeader>
      <CardContent className="grid gap-2">
        {days.map((d, i) => (
          <div
            key={DAYS[i]}
            className="grid grid-cols-[120px_1fr] items-center gap-3 sm:grid-cols-[140px_auto_auto_1fr]"
          >
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={d.enabled}
                onChange={(e) => update(i, { enabled: e.target.checked })}
                className="accent-[var(--primary)]"
              />
              {DAYS[i]}
            </label>
            {d.enabled ? (
              <>
                <div className="flex items-center gap-2">
                  <Input
                    type="time"
                    aria-label={`${DAYS[i]} start`}
                    className="w-28"
                    value={d.start}
                    onChange={(e) => update(i, { start: e.target.value })}
                  />
                  <span className="text-muted-foreground">-</span>
                  <Input
                    type="time"
                    aria-label={`${DAYS[i]} end`}
                    className="w-28"
                    value={d.end}
                    onChange={(e) => update(i, { end: e.target.value })}
                  />
                </div>
                <div className="text-muted-foreground col-span-2 flex items-center gap-2 text-sm sm:col-span-1">
                  Break
                  <Input
                    type="time"
                    aria-label={`${DAYS[i]} break start`}
                    className="w-28"
                    value={d.breakStart}
                    onChange={(e) => update(i, { breakStart: e.target.value })}
                  />
                  <span>-</span>
                  <Input
                    type="time"
                    aria-label={`${DAYS[i]} break end`}
                    className="w-28"
                    value={d.breakEnd}
                    onChange={(e) => update(i, { breakEnd: e.target.value })}
                  />
                </div>
              </>
            ) : (
              <p className="text-muted-foreground text-sm">Unavailable</p>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
