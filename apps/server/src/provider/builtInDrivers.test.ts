import { describe, expect, it } from "@effect/vitest";
import {
  defaultInstanceIdForDriver,
  ProviderDriverKind,
  ProviderInstanceId,
} from "@t3tools/contracts";

import { BUILT_IN_DRIVERS } from "./builtInDrivers.ts";
import { KimiDriver } from "./Drivers/KimiDriver.ts";
import { OllamaDriver } from "./Drivers/OllamaDriver.ts";

const KIMI_DRIVER_KIND = ProviderDriverKind.make("kimi");
const OLLAMA_DRIVER_KIND = ProviderDriverKind.make("ollama");

describe("Kimi built-in driver", () => {
  it("resolves the default kimi instance to the Kimi driver", () => {
    expect(defaultInstanceIdForDriver(KIMI_DRIVER_KIND)).toBe(ProviderInstanceId.make("kimi"));
    expect(BUILT_IN_DRIVERS.find((driver) => driver.driverKind === KIMI_DRIVER_KIND)).toBe(
      KimiDriver,
    );
  });
});

describe("Ollama built-in driver", () => {
  it("resolves the default ollama instance to the Ollama driver", () => {
    expect(defaultInstanceIdForDriver(OLLAMA_DRIVER_KIND)).toBe(ProviderInstanceId.make("ollama"));
    expect(BUILT_IN_DRIVERS.find((driver) => driver.driverKind === OLLAMA_DRIVER_KIND)).toBe(
      OllamaDriver,
    );
  });
});
