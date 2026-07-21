// Pure retention math. Manila (UTC+8, no DST) — fixed offset.
export const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;

export function manilaDay(iso: string | Date): string {
  const t = typeof iso === "string" ? new Date(iso).getTime() : iso.getTime();
  return new Date(t + MANILA_OFFSET_MS).toISOString().slice(0, 10);
}

export function addDaysISO(day: string, n: number): string {
  const d = new Date(day + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export type Signup = { user_id: string; created_at: string };
export type Entry = { user_id: string; logged_at: string };

export type CohortRow = {
  cohort: string;
  users: number;
  activated: number;
  d1: number; // active exactly on signup+1 (Manila calendar day)
  d7Exact: number; // active exactly on signup+7
  d7Return: number; // active any day in signup+1..signup+7 (rolling 7-day return)
  matureD1: number; // signup+1 has fully elapsed
  matureD7: number; // signup+7 has fully elapsed
};

export type RetentionResult = {
  overall: {
    users: number;
    activated: number;
    activationRate: number;
    d1: number;
    matureD1: number;
    d1Rate: number;
    d7Exact: number;
    matureD7: number;
    d7ExactRate: number;
    d7Return: number;
    d7ReturnRate: number;
  };
  cohorts: CohortRow[];
};

function weekStart(day: string): string {
  const d = new Date(day + "T00:00:00Z");
  const dow = (d.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

export function computeRetention(
  signups: Signup[],
  entries: Entry[],
  now: Date,
): RetentionResult {
  const todayManila = manilaDay(now.toISOString());

  const activeDays = new Map<string, Set<string>>();
  for (const e of entries) {
    let s = activeDays.get(e.user_id);
    if (!s) {
      s = new Set();
      activeDays.set(e.user_id, s);
    }
    s.add(manilaDay(e.logged_at));
  }

  const cohorts = new Map<string, CohortRow>();
  const o = {
    users: 0,
    activated: 0,
    d1: 0,
    matureD1: 0,
    d7Exact: 0,
    d7Return: 0,
    matureD7: 0,
  };

  for (const p of signups) {
    const signupDay = manilaDay(p.created_at);
    const bucket = weekStart(signupDay);
    let c = cohorts.get(bucket);
    if (!c) {
      c = {
        cohort: bucket,
        users: 0,
        activated: 0,
        d1: 0,
        d7Exact: 0,
        d7Return: 0,
        matureD1: 0,
        matureD7: 0,
      };
      cohorts.set(bucket, c);
    }
    c.users += 1;
    o.users += 1;
    const active = activeDays.get(p.user_id) ?? new Set<string>();
    if (active.has(signupDay)) {
      c.activated += 1;
      o.activated += 1;
    }

    // D1 mature = signup+1 has fully elapsed (i.e. signup+2 <= today, so all of +1 is past).
    const d1Day = addDaysISO(signupDay, 1);
    if (addDaysISO(signupDay, 2) <= todayManila) {
      c.matureD1 += 1;
      o.matureD1 += 1;
      if (active.has(d1Day)) {
        c.d1 += 1;
        o.d1 += 1;
      }
    }

    // D7 window mature = signup+7 fully elapsed (signup+8 <= today).
    if (addDaysISO(signupDay, 8) <= todayManila) {
      c.matureD7 += 1;
      o.matureD7 += 1;
      const d7Day = addDaysISO(signupDay, 7);
      if (active.has(d7Day)) {
        c.d7Exact += 1;
        o.d7Exact += 1;
      }
      for (let i = 1; i <= 7; i++) {
        if (active.has(addDaysISO(signupDay, i))) {
          c.d7Return += 1;
          o.d7Return += 1;
          break;
        }
      }
    }
  }

  const list = Array.from(cohorts.values()).sort((a, b) => b.cohort.localeCompare(a.cohort));
  return {
    overall: {
      users: o.users,
      activated: o.activated,
      activationRate: o.users ? o.activated / o.users : 0,
      d1: o.d1,
      matureD1: o.matureD1,
      d1Rate: o.matureD1 ? o.d1 / o.matureD1 : 0,
      d7Exact: o.d7Exact,
      matureD7: o.matureD7,
      d7ExactRate: o.matureD7 ? o.d7Exact / o.matureD7 : 0,
      d7Return: o.d7Return,
      d7ReturnRate: o.matureD7 ? o.d7Return / o.matureD7 : 0,
    },
    cohorts: list,
  };
}