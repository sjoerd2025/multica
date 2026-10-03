import type { Plugin } from "@opencode/plugin";
import { jevApproves, neverAutoApprove, type State } from "./jev.js";

type Event = Parameters<Parameters<Plugin.Context["permission"]["hook"]>[1]>[0];

export default {
  id: "jev-permissions",
  setup: async (ctx) => {
    await ctx.permission.hook("evaluate", async (event) => {
      if (event.effect !== "ask" || event.action !== "shell") return;
      if (event.resources.some(neverAutoApprove)) return;
      if ((await jevApproves(await buildState(ctx, event))) === true) {
        event.effect = "allow";
      }
    });
  },
} satisfies Plugin.Plugin;

async function buildState(ctx: Plugin.Context, event: Event): Promise<State> {
  const messages = await ctx.session.context({ sessionID: event.sessionID });
  const task = messages
    .filter((message) => message.type === "user")
    .at(-1)?.text.slice(0, 2_000);
  return {
    task,
    project: ctx.location.directory,
    agent: event.agent,
    commands: event.resources,
  };
}
