#!/usr/bin/env node
import { check } from "./check.js";
import { review } from "./review.js";
import { installHook, removeHook } from "./hooks.js";

const args = process.argv.slice(2);
const command = args[0];

const modelFlag = args.indexOf("--model");
const model = modelFlag >= 0 ? args[modelFlag + 1] : undefined;

switch (command) {
  case "install":
    installHook(model);
    console.log("Hook installed in", ".claude/settings.local.json");
    break;

  case "off":
    removeHook();
    console.log("Hook removed.");
    break;

  case "check":
    check(model);
    break;

  case "review":
    review(model).catch((err) => {
      console.error(err);
      process.exit(1);
    });
    break;

  default:
    installHook(model);
    console.log("Hook installed in", ".claude/settings.local.json");
    break;
}
