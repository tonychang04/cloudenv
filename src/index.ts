#!/usr/bin/env node

import { Command } from "commander";
import { loginCommand } from "./commands/login";
import { upCommand } from "./commands/up";
import { downCommand } from "./commands/down";
import { listCommand } from "./commands/list";
import { logsCommand } from "./commands/logs";
import { statusCommand } from "./commands/status";

const program = new Command();

program
  .name("cloudenv")
  .description("Ephemeral full-stack environments per git branch")
  .version("0.1.0");

program.addCommand(loginCommand);
program.addCommand(upCommand);
program.addCommand(downCommand);
program.addCommand(listCommand);
program.addCommand(logsCommand);
program.addCommand(statusCommand);

program.parse();
