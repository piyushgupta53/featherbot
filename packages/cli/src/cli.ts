import { Command } from "commander";
import { registerAgent } from "./commands/agent.js";
import { registerGateway } from "./commands/gateway.js";
import { registerOnboard } from "./commands/onboard.js";
import { registerStatus } from "./commands/status.js";
import { VERSION } from "./index.js";

export const program = new Command();

program.name("featherbot").version(VERSION).description("FeatherBot — personal AI agent");

registerOnboard(program);
registerAgent(program);
registerStatus(program);
registerGateway(program);
