import chalk from "chalk";

import { getVersion } from "./version.js";

const d = chalk.dim;
const em = chalk.hex("#10b981");

export const AI_FIREWALL_ASCII_ART = `
${em(` █████╗ ██╗    ███████╗██╗██████╗ ███████╗██╗    ██╗ █████╗ ██╗     ██╗
██╔══██╗██║    ██╔════╝██║██╔══██╗██╔════╝██║    ██║██╔══██╗██║     ██║
███████║██║    █████╗  ██║██████╔╝█████╗  ██║ █╗ ██║███████║██║     ██║
██╔══██║██║    ██╔══╝  ██║██╔══██╗██╔══╝  ██║███╗██║██╔══██║██║     ██║
██║  ██║██║    ██║     ██║██║  ██║███████╗╚███╔███╔╝██║  ██║███████╗███████╗
╚═╝  ╚═╝╚═╝    ╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝ ╚══╝╚══╝ ╚═╝  ╚═╝╚══════╝╚══════╝`)}
                                                    ${d("v" + getVersion())}`;

const AF_ASCII_ART = `
${em(` █████╗ ███████╗
██╔══██╗██╔════╝
███████║█████╗
██╔══██║██╔══╝
██║  ██║██║
╚═╝  ╚═╝╚═╝`)}
  ${d("v" + getVersion())}`;

// Minimum terminal width required to display ASCII art properly
const MIN_WIDTH_FOR_ASCII_ART = 75;

/**
 * Returns the ASCII art only if the terminal is wide enough to display it properly.
 * If terminal is too narrow, returns just the version string.
 */
export function getDisplayableAsciiArt(): string {
  const terminalWidth = process.stdout.columns || 80;

  if (terminalWidth >= MIN_WIDTH_FOR_ASCII_ART) {
    return AI_FIREWALL_ASCII_ART;
  }

  return AF_ASCII_ART;
}

export const AI_FIREWALL_LOGO_ASCII_ART = `
${em(`
     @@@@@@@@@@@@@@@@
   @@@@@@@@@@@@@@@@@@@@
  @@@@@@              @@@@
 @@@@@    @@@@@@@@@@    @@@@
 @@@@   @@@@@@@@@@@@@@   @@@@
@@@@   @@@@@@@@@@@@@@@@   @@@@
@@@@   @@@@@@@@@@@@@@@@   @@@@
@@@@   @@@@              @@@@
@@@@    @@   AI FIREWALL   @@
@@@@   @@@@              @@@@
@@@@   @@@@@@@@@@@@@@@@   @@@@
@@@@   @@@@@@@@@@@@@@@@   @@@@
 @@@@   @@@@@@@@@@@@@@   @@@@
 @@@@@    @@@@@@@@@@    @@@@
  @@@@@@              @@@@
   @@@@@@@@@@@@@@@@@@@@
     @@@@@@@@@@@@@@@@`)}
`;
