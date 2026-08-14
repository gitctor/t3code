import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { makeAccountLimitsLiveRefreshTrigger } from "./AccountLimitsService.ts";

describe("makeAccountLimitsLiveRefreshTrigger", () => {
  it.effect("runs the live provider refresh installed by runtime ingestion", () =>
    Effect.gen(function* () {
      let calls = 0;
      const trigger = makeAccountLimitsLiveRefreshTrigger();
      trigger.register(() =>
        Effect.sync(() => {
          calls += 1;
        }),
      );

      yield* trigger.run();
      expect(calls).toBe(1);
    }),
  );

  it.effect("is a no-op before provider runtime wiring is ready", () =>
    Effect.gen(function* () {
      const trigger = makeAccountLimitsLiveRefreshTrigger();
      yield* trigger.run();
      expect(true).toBe(true);
    }),
  );
});
