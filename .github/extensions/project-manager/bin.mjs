#!/usr/bin/env node
// bin.mjs — standalone runner for Ming's project board, independent of the
// optional Copilot canvas host. Run it from any terminal and open the URL:
//
//   node .github/extensions/project-manager/bin.mjs
//
// It shares board.mjs and server.mjs with the canvas extension and reads the
// same data/board.json, so every open view stays in sync.

import { startServer } from "./server.mjs";

async function main() {
    const { url, close } = await startServer();

    console.log(`Ming project board running at: ${url}`);
    console.log("Reading/writing data/board.json — shared with agents and other open panels.");
    console.log("Press Ctrl+C to stop.");

    const shutdown = async () => {
        console.log("\nShutting down...");
        await close();
        process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
}

main().catch((err) => {
    console.error("Failed to start the project board:", err);
    process.exit(1);
});
