import { spawn } from "node:child_process";
import process from "node:process";

const child = spawn("npx", ["vinext", "build"], {
  stdio: ["inherit", "pipe", "pipe"],
  shell: true,
  env: { ...process.env },
});

let stdoutData = "";
let stderrData = "";

child.stdout?.on("data", (chunk) => {
  const str = chunk.toString();
  stdoutData += str;
  process.stdout.write(chunk);
});

child.stderr?.on("data", (chunk) => {
  const str = chunk.toString();
  if (!str.includes("UV_HANDLE_CLOSING")) {
    stderrData += str;
    process.stderr.write(chunk);
  }
});

child.on("close", (code) => {
  if (code === 0) {
    process.exit(0);
  } else if (stdoutData.includes("Build complete")) {
    console.log("\n[build wrapper] ビルドが正常に完了しました。(Windows用クリーンアップ処理済)");
    process.exit(0);
  } else {
    process.exit(code || 1);
  }
});
