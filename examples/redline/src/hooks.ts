import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const SETTINGS_PATH = join(".claude", "settings.local.json");
const HOOK_PREFIX = "redline";

export function readSettings(): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(SETTINGS_PATH, "utf-8"));
  } catch {
    return {};
  }
}

export function writeSettings(settings: Record<string, unknown>): void {
  mkdirSync(".claude", { recursive: true });
  writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + "\n");
}

export function installHook(model?: string): void {
  const settings = readSettings();
  const command = model ? `${HOOK_PREFIX} check --model ${model}` : `${HOOK_PREFIX} check`;

  const hookEntry = {
    hooks: [
      {
        type: "command",
        command,
        timeout: 10,
      },
    ],
  };

  const hooks = (settings.hooks ?? {}) as Record<string, unknown[]>;
  const stopHooks = (hooks.Stop ?? []) as Array<{ hooks: Array<{ command: string }> }>;

  // Check for existing redline hook
  const existing = stopHooks.findIndex((h) =>
    h.hooks?.some((inner) => inner.command?.startsWith(HOOK_PREFIX)),
  );

  if (existing >= 0) {
    stopHooks[existing] = hookEntry;
  } else {
    stopHooks.push(hookEntry);
  }

  hooks.Stop = stopHooks;
  settings.hooks = hooks;
  writeSettings(settings);
}

export function removeHook(): void {
  const settings = readSettings();
  const hooks = (settings.hooks ?? {}) as Record<string, unknown[]>;
  const stopHooks = (hooks.Stop ?? []) as Array<{ hooks: Array<{ command: string }> }>;

  hooks.Stop = stopHooks.filter(
    (h) => !h.hooks?.some((inner) => inner.command?.startsWith(HOOK_PREFIX)),
  );

  if (Array.isArray(hooks.Stop) && hooks.Stop.length === 0) {
    delete hooks.Stop;
  }
  if (Object.keys(hooks).length === 0) {
    delete settings.hooks;
  }

  writeSettings(settings);
}
