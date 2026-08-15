import { OllamaSettings, ProviderDriverKind, type ServerProvider } from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";
import { HttpClient } from "effect/unstable/http";

import * as BackgroundPolicy from "../../background/BackgroundPolicy.ts";
import { ServerConfig } from "../../config.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { makeOllamaTextGeneration } from "../../textGeneration/OllamaTextGeneration.ts";
import { ProviderDriverError } from "../Errors.ts";
import { makeOllamaAdapter } from "../Layers/OllamaAdapter.ts";
import {
  buildInitialOllamaProviderSnapshot,
  checkOllamaProviderStatus,
} from "../Layers/OllamaProvider.ts";
import { makeManagedServerProvider } from "../makeManagedServerProvider.ts";
import {
  defaultProviderContinuationIdentity,
  type ProviderDriver,
  type ProviderInstance,
} from "../ProviderDriver.ts";
import type { ServerProviderDraft } from "../providerSnapshot.ts";
import { makeManualOnlyProviderMaintenanceCapabilities } from "../providerMaintenance.ts";
import {
  haveProviderSnapshotSettingsChanged,
  makeProviderSnapshotSettingsSource,
  type ProviderSnapshotSettings,
} from "../providerUpdateSettings.ts";

const decodeOllamaSettings = Schema.decodeSync(OllamaSettings);
const DRIVER_KIND = ProviderDriverKind.make("ollama");

export type OllamaDriverEnv =
  | BackgroundPolicy.BackgroundPolicy
  | Crypto.Crypto
  | FileSystem.FileSystem
  | HttpClient.HttpClient
  | ServerConfig
  | ServerSettingsService;

const withInstanceIdentity =
  (input: {
    readonly instanceId: ProviderInstance["instanceId"];
    readonly displayName: string | undefined;
    readonly accentColor: string | undefined;
    readonly continuationGroupKey: string;
  }) =>
  (snapshot: ServerProviderDraft): ServerProvider => ({
    ...snapshot,
    instanceId: input.instanceId,
    driver: DRIVER_KIND,
    ...(input.displayName ? { displayName: input.displayName } : {}),
    ...(input.accentColor ? { accentColor: input.accentColor } : {}),
    continuation: { groupKey: input.continuationGroupKey },
  });

export const OllamaDriver: ProviderDriver<OllamaSettings, OllamaDriverEnv> = {
  driverKind: DRIVER_KIND,
  metadata: {
    displayName: "Ollama",
    supportsMultipleInstances: true,
  },
  configSchema: OllamaSettings,
  defaultConfig: (): OllamaSettings => decodeOllamaSettings({}),
  create: ({ instanceId, displayName, accentColor, enabled, config }) =>
    Effect.gen(function* () {
      const crypto = yield* Crypto.Crypto;
      const fileSystem = yield* FileSystem.FileSystem;
      const httpClient = yield* HttpClient.HttpClient;
      const serverConfig = yield* ServerConfig;
      const serverSettings = yield* ServerSettingsService;
      const continuationIdentity = defaultProviderContinuationIdentity({
        driverKind: DRIVER_KIND,
        instanceId,
      });
      const stampIdentity = withInstanceIdentity({
        instanceId,
        displayName,
        accentColor,
        continuationGroupKey: continuationIdentity.continuationKey,
      });
      const effectiveConfig = { ...config, enabled } satisfies OllamaSettings;
      const maintenanceCapabilities = makeManualOnlyProviderMaintenanceCapabilities({
        provider: DRIVER_KIND,
        packageName: null,
      });

      const adapter = yield* makeOllamaAdapter(effectiveConfig, { instanceId }).pipe(
        Effect.provideService(Crypto.Crypto, crypto),
        Effect.provideService(FileSystem.FileSystem, fileSystem),
        Effect.provideService(HttpClient.HttpClient, httpClient),
        Effect.provideService(ServerConfig, serverConfig),
      );
      const textGeneration = yield* makeOllamaTextGeneration(effectiveConfig).pipe(
        Effect.provideService(HttpClient.HttpClient, httpClient),
      );
      const checkProvider = checkOllamaProviderStatus(effectiveConfig).pipe(
        Effect.map(stampIdentity),
        Effect.provideService(HttpClient.HttpClient, httpClient),
      );
      const snapshotSettings = makeProviderSnapshotSettingsSource(effectiveConfig, serverSettings);
      const snapshot = yield* makeManagedServerProvider<ProviderSnapshotSettings<OllamaSettings>>({
        maintenanceCapabilities,
        getSettings: snapshotSettings.getSettings,
        streamSettings: snapshotSettings.streamSettings,
        haveSettingsChanged: haveProviderSnapshotSettingsChanged,
        initialSnapshot: (settings) =>
          buildInitialOllamaProviderSnapshot(settings.provider).pipe(Effect.map(stampIdentity)),
        checkProvider,
      }).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderDriverError({
              driver: DRIVER_KIND,
              instanceId,
              detail: `Failed to build Ollama snapshot: ${cause.message ?? String(cause)}`,
              cause,
            }),
        ),
      );

      return {
        instanceId,
        driverKind: DRIVER_KIND,
        continuationIdentity,
        displayName,
        accentColor,
        enabled,
        snapshot,
        adapter,
        textGeneration,
      } satisfies ProviderInstance;
    }),
};
