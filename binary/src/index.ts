process.env.IS_BINARY = "true";
import { Command } from "commander";
import { Core } from "core/core";
import { LLMLogFormatter } from "core/llm/logFormatter";
import { FromCoreProtocol, ToCoreProtocol } from "core/protocol";
import { IMessenger } from "core/protocol/messenger";
import { getCoreLogsPath, getPromptLogsPath } from "core/util/paths";
import fs from "node:fs";
import { IpcIde } from "./IpcIde";
import { IpcMessenger } from "./IpcMessenger";
import { setupCoreLogging } from "./logging";
import { TcpMessenger } from "./TcpMessenger";
import { wrapWithScanner } from "../../core/util/scanning/ScanningIde";

const logFilePath = getCoreLogsPath();
fs.appendFileSync(logFilePath, "[info] Starting Continue core...\n");

const program = new Command();

program.action(async () => {
  try {
    let messenger: IMessenger<ToCoreProtocol, FromCoreProtocol>;
    if (process.env.AI_FIREWALL_DEVELOPMENT === "true") {
      messenger = new TcpMessenger<ToCoreProtocol, FromCoreProtocol>();
      console.log("[binary] Waiting for connection");
      await (
        messenger as TcpMessenger<ToCoreProtocol, FromCoreProtocol>
      ).awaitConnection();
      console.log("[binary] Connected");
    } else {
      setupCoreLogging();
      // await setupCa();
      messenger = new IpcMessenger<ToCoreProtocol, FromCoreProtocol>();
    }
    // AI Firewall scanning chokepoint: every IDE file read/write
    // flows through the scanner here. JetBrains + the binary both
    // route through this path, so wrapping once covers both.
    const ide = wrapWithScanner(new IpcIde(messenger));
    const promptLogsPath = getPromptLogsPath();

    const core = new Core(messenger, ide);
    new LLMLogFormatter(core.llmLogger, fs.createWriteStream(promptLogsPath));

    console.log("[binary] Core started");
  } catch (e) {
    fs.writeFileSync("./error.log", `${new Date().toISOString()} ${e}\n`);
    console.log("Error: ", e);
    process.exit(1);
  }
});

program.parse(process.argv);
