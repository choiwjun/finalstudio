// Process-local offline boundary: no real child process may escape this fixture.
const cp = require("node:child_process");
const fs = require("node:fs");
const { EventEmitter } = require("node:events");
const { syncBuiltinESMExports } = require("node:module");
const { join } = require("node:path");
let responses;
try {
    responses = JSON.parse(fs.readFileSync("responses.json", "utf8"));
} catch (error) {
    throw new Error("Cannot load offline writer response fixture", {
        cause: error,
    });
}
cp.execFileSync = (command, args) => {
    if (["which", "where"].includes(command) && args[0] === "codex")
        return "/offline/codex";
    if (
        command === "node" &&
        args[0] === join(process.cwd(), "scripts/auto-publish/convert-post.mjs")
    ) {
        fs.writeFileSync("converted.md", fs.readFileSync(args[1]));
        fs.writeFileSync("conversion-args.json", JSON.stringify(args));
        return "offline conversion boundary";
    }
    throw new Error(`Unexpected subprocess: ${command} ${args}`);
};
cp.spawn = (command, args) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    let system = "";
    child.stdin = {
        write: (text) => {
            system += text;
        },
        end: () => {
            process.nextTick(() => {
                const login = args.includes("login");
                if (!login && !args.includes("exec"))
                    throw new Error(`Unexpected Codex call: ${args}`);
                const response = login ? "offline login" : responses[0];
                if (!login) {
                    responses = responses.slice(1);
                    fs.appendFileSync(
                        "calls.jsonl",
                        JSON.stringify({ system, input: args.at(-1) }) + "\n",
                    );
                }
                if (response === undefined)
                    throw new Error("Offline response queue exhausted");
                child.stdout.emit("data", response);
                child.emit("close", 0);
            });
        },
    };
    return child;
};
syncBuiltinESMExports();
