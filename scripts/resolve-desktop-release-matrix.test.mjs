import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const script = fileURLToPath(new URL("./resolve-desktop-release-matrix.mjs", import.meta.url));
const existingOutput = "existing=value\n";
const platforms = {
  mac: {
    os: "mac",
    runner: "macos-latest",
    "default-arch": "arm64",
    "targets-env": "",
    "build-targets": "dmg,zip",
    "artifact-exts": "*.dmg *.zip",
  },
  win: {
    os: "win",
    runner: "windows-latest",
    "default-arch": "x64",
    "targets-env": "nsis,zip",
    "build-targets": "nsis,zip",
    "artifact-exts": "*.exe *.zip",
  },
  linux: {
    os: "linux",
    runner: "ubuntu-latest",
    "default-arch": "x64",
    "targets-env": "AppImage,deb",
    "build-targets": "AppImage,deb",
    "artifact-exts": "*.AppImage *.deb",
  },
};

async function createOutput(t) {
  const directory = await mkdtemp(join(tmpdir(), "zcode-release-matrix-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const output = join(directory, "output.txt");
  await writeFile(output, existingOutput);
  return output;
}

for (const [event, os, expected] of [
  ["push", "", ["mac", "win", "linux"]],
  ["push", "win", ["mac", "win", "linux"]],
  ["workflow_dispatch", "all", ["mac", "win", "linux"]],
  ["workflow_dispatch", "mac", ["mac"]],
  ["workflow_dispatch", "win", ["win"]],
  ["workflow_dispatch", "linux", ["linux"]],
]) {
  test(`${event} with os=${os || "(absent)"} schedules ${expected.join(", ")}`, async (t) => {
    const output = await createOutput(t);
    await execFileAsync(process.execPath, [script], {
      env: { ...process.env, GITHUB_EVENT_NAME: event, RELEASE_OS: os, GITHUB_OUTPUT: output },
    });
    const content = await readFile(output, "utf8");
    assert.ok(content.startsWith(existingOutput));
    const match = /^matrix=([^\r\n]+)\n$/.exec(content.slice(existingOutput.length));
    assert.ok(match, "GitHub must receive exactly one JSON matrix output line");
    assert.deepEqual(JSON.parse(match[1]), { include: expected.map((key) => platforms[key]) });
  });
}

for (const os of ["", "unknown"]) {
  test(`manual os=${os || "(absent)"} fails without emitting a matrix`, async (t) => {
    const output = await createOutput(t);
    await assert.rejects(
      execFileAsync(process.execPath, [script], {
        env: {
          ...process.env,
          GITHUB_EVENT_NAME: "workflow_dispatch",
          RELEASE_OS: os,
          GITHUB_OUTPUT: output,
        },
      }),
      (error) => error.code === 1 && /Unsupported release platform/.test(error.stderr),
    );
    assert.equal(await readFile(output, "utf8"), existingOutput);
  });
}
