// jobs/tournamentCron.js
import cron from "node-cron";
import { DateTime } from "luxon";
import {
  finalizeExpiredTournaments,
  markOngoingTournaments,
} from "../services/tournamentLifecycle.js";

const DEFAULT_TZ = process.env.CRON_TZ || "Asia/Ho_Chi_Minh"; // hoặc Asia/Bangkok

function ts(tz = DEFAULT_TZ) {
  const now = DateTime.now().setZone(tz);
  return {
    iso: now.toISO(),
    local: now.toFormat("yyyy-LL-dd HH:mm:ss ZZZZ"),
    tz,
  };
}

export function startTournamentCrons() {
  const bootTs = ts();
  console.log(
    `[cron][boot] starting tournament crons @ ${bootTs.local} (${bootTs.tz})`
  );

  // Chạy 1 lần lúc boot (có log)
  (async () => {
    try {
      const t0 = Date.now();
      const ongoing = await markOngoingTournaments();
      const done1 = Date.now();
      const finished = await finalizeExpiredTournaments();
      const done2 = Date.now();

      const bootRunTs = ts();
      console.log(
        `[cron][boot-run] ok @ ${bootRunTs.local} — ongoing.modified=${
          ongoing.modified
        } (${done1 - t0}ms), finished.finished=${finished.finished} (${
          done2 - done1
        }ms)`
      );
    } catch (e) {
      const errTs = ts();
      console.error(`[cron][boot-run] error @ ${errTs.local}:`, e);
    }
  })();

  // 1) Ongoing: mỗi phút
  cron.schedule(
    "* * * * *",
    async () => {
      const start = Date.now();
      try {
        const r = await markOngoingTournaments();
        const end = Date.now();
        const tickTs = ts();
        console.log(
          `[cron][ongoing] success @ ${tickTs.local} — modified=${
            r.modified
          }, took=${end - start}ms`
        );
      } catch (e) {
        const errTs = ts();
        console.error(`[cron][ongoing] error @ ${errTs.local}:`, e);
      }
    },
    { timezone: DEFAULT_TZ }
  );

  // 2) Finish: mỗi 5 phút
  cron.schedule(
    "* * * * *",
    async () => {
      const start = Date.now();
      try {
        const r = await finalizeExpiredTournaments();
        const end = Date.now();
        const tickTs = ts();
        console.log(
          `[cron][finish] success @ ${tickTs.local} — checked=${
            r.checked
          }, finished=${r.finished}, took=${end - start}ms`
        );
      } catch (e) {
        const errTs = ts();
        console.error(`[cron][finish] error @ ${errTs.local}:`, e);
      }
    },
    { timezone: DEFAULT_TZ }
  );
}
