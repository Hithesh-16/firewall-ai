const path = require("path");
process.env.AI_FIREWALL_DEVELOPMENT = true;

process.env.AI_FIREWALL_GLOBAL_DIR = path.join(
  process.env.PROJECT_DIR,
  "extensions",
  ".continue-debug",
);

require("./out/index.js");
