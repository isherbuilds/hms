import { expect, test } from "bun:test";

import { sessionGate } from "../../apps/web/src/lib/session-gate";

test("session reconciliation waits initially but redirects after expiry or revocation", () => {
  expect(sessionGate(false, true, false)).toBe("loading");
  expect(sessionGate(false, false, false)).toBe("loading");
  expect(sessionGate(false, false, true)).toBe("ready");
  expect(sessionGate(true, false, false)).toBe("redirect");
});
