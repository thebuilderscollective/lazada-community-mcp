#!/usr/bin/env node
const [command, ...args] = process.argv.slice(2);
if (command === "setup") {
  const { setup } = await import("./setup.mjs");
  await setup(args).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
} else if (command === "--help" || command === "help") {
  console.log(
    "Lazada shopping assistant\n\n  lazada-mcp setup codex   Install and connect to Codex\n  lazada-mcp setup claude  Install and connect to Claude Code\n  lazada-mcp setup config  Install and print configuration for other clients\n  lazada-mcp               Start the MCP server",
  );
} else if (command) {
  console.error(`Unknown command: ${command}. Use lazada-mcp --help.`);
  process.exitCode = 1;
} else {
  await import("./launch-mcp.mjs");
}
