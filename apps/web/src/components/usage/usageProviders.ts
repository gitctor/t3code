import type { UsageProviderKind } from "@t3tools/contracts";

import { ClaudeAI, type Icon, KimiIcon, OllamaIcon, OpenAI } from "../Icons";

/**
 * Series and table order. The chart layers both providers from a shared zero
 * baseline, so this only fixes the reading order of legends, tables and hover
 * rows; it does not decide which series sits above the other.
 */
export const PROVIDER_ORDER: readonly UsageProviderKind[] = ["codex", "claude"];

export const PROVIDER_LABEL: Record<UsageProviderKind, string> = {
  claude: "Claude Code",
  codex: "Codex",
};

/** Claude's brand orange against a neutral white for Codex. */
export const PROVIDER_COLOR: Record<UsageProviderKind, string> = {
  claude: "#d97757",
  codex: "#e6e6e6",
};

/**
 * Brand marks, reused from the provider picker.
 *
 * These ship their own fills (`#d97757` for Claude, white on dark for OpenAI),
 * which are the same colours as the chart bands, so swapping a colour dot for a
 * mark keeps the series association intact rather than trading it away.
 */
export const PROVIDER_MARK: Record<UsageProviderKind, Icon> = {
  claude: ClaudeAI,
  codex: OpenAI,
};

/** Kimi is visible here even though its ACP stream does not report account limits. */
export type AccountLimitProviderKind = UsageProviderKind | "kimi" | "ollama";

export const ACCOUNT_LIMIT_PROVIDER_ORDER: readonly AccountLimitProviderKind[] = [
  ...PROVIDER_ORDER,
  "kimi",
  "ollama",
];

export const ACCOUNT_LIMIT_PROVIDER_LABEL: Record<AccountLimitProviderKind, string> = {
  ...PROVIDER_LABEL,
  kimi: "Kimi Code",
  ollama: "Ollama",
};

export const ACCOUNT_LIMIT_PROVIDER_COLOR: Record<AccountLimitProviderKind, string> = {
  ...PROVIDER_COLOR,
  kimi: "#1783ff",
  ollama: "#e6e6e6",
};

export const ACCOUNT_LIMIT_PROVIDER_MARK: Record<AccountLimitProviderKind, Icon> = {
  ...PROVIDER_MARK,
  kimi: KimiIcon,
  ollama: OllamaIcon,
};

export function accountLimitEmptyStateCopy(
  provider: AccountLimitProviderKind,
  isLoading: boolean,
): string {
  if (provider === "kimi") return "Limits not reported by provider.";
  if (provider === "ollama") return "Local — free";
  if (isLoading) return "Loading…";
  if (provider === "claude") {
    return "No limit data yet — appears after your first Claude turn.";
  }
  return "No limit data yet";
}
