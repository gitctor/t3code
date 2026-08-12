import { describe, expect, it } from "@effect/vitest";
import {
  defaultInstanceIdForDriver,
  ProviderDriverKind,
  ProviderInstanceId,
} from "@t3tools/contracts";

import { BUILT_IN_DRIVERS } from "./builtInDrivers.ts";
import { KimiDriver } from "./Drivers/KimiDriver.ts";

const KIMI_DRIVER_KIND = ProviderDriverKind.make("kimi");

describe("Kimi built-in driver", () => {
  it("resolves the default kimi instance to the Kimi driver", () => {
    expect(defaultInstanceIdForDriver(KIMI_DRIVER_KIND)).toBe(ProviderInstanceId.make("kimi"));
    expect(BUILT_IN_DRIVERS.find((driver) => driver.driverKind === KIMI_DRIVER_KIND)).toBe(
      KimiDriver,
    );
  });
});
