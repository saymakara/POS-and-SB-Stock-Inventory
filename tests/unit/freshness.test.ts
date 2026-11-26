// (26 Nov 2026) A screen's copy stays valid while the live feed is connected (every change empties it), at most 10 minutes;
// without the live feed the short rule applies; after a reconnect every copy is read again once. Run: npx tsx tests/unit/freshness.test.ts
import { clearFresh, isFresh, liveMaxAge, markFresh, setLiveSync } from '../../src/utils/freshness';
let fails = 0;
const ok = (c: boolean, m: string) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
let now = 1_000_000;
Date.now = () => now;
markFresh('mv:p:x'); markFresh('qr:e:x'); markFresh('field');
now += 60_000;                                                        // 1 minute later
ok(!isFresh('mv:p:x'), 'live feed not connected: after 1 minute the copy is old (45 s rule, as before)');
setLiveSync(true);
ok(isFresh('mv:p:x') && isFresh('field'), 'live feed connected: Merchant Visit / POS-SB review copies still valid after 1 minute');
ok(!isFresh('qr:e:x'), 'KHQR list keeps its own rule (new entries are shown by its banner, not the feed)');
now += 10 * 60_000;
ok(!isFresh('mv:p:x'), 'safety limit: never older than 10 minutes');
markFresh('mv:p:x'); now += 5 * 60_000;
ok(isFresh('mv:p:x'), '5 minutes, feed connected: valid');
setLiveSync(false);
ok(!isFresh('mv:p:x'), 'feed drops: short rule again at once');
setLiveSync(true);
ok(!isFresh('mv:p:x') && !isFresh('field'), 'feed back: every copy is read again once (changes may have been missed)');
ok(liveMaxAge(120_000) === 600_000 && liveMaxAge(0) === 0, 'Credit Card copy: 10 minutes while live; "Refresh" (0) always asks the database');
setLiveSync(false);
ok(liveMaxAge(120_000) === 120_000, 'Credit Card copy without the feed: 2 minutes, as before');
clearFresh();
console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
process.exit(fails ? 1 : 0);
