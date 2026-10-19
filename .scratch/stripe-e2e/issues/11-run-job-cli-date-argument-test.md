# 11: Test the `npm run job` date argument

**What to build:** Issue 03 added an optional as-of date to `npm run job -- <grace|trial|reconcile> [date]`, so a sweep can follow a Stripe test clock. The date is read and validated in `backend/src/scripts/run-job.ts`, which has no test. Only `runJob(name, now)` underneath it is tested. Cover the CLI's own behaviour: a valid date is passed through, no date means "now", and an unparseable date fails with a clear message and a non-zero exit, without running the job.

**Blocked by:** 03: Trial ends and the first invoice is paid

**Status:** ready-for-agent

- [ ] A valid date argument reaches the job as its `now`
- [ ] No date argument runs the job as of the current time
- [ ] An invalid date exits non-zero with `Invalid date "<arg>"` and runs nothing
- [ ] No change to how the job behaves when run on its interval
