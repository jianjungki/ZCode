import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { parse } from "yaml";

const execFileAsync = promisify(execFile);
const workflow = parse(
  await readFile(
    new URL("../.github/workflows/build-desktop-release.yml", import.meta.url),
    "utf8",
  ),
);
const collect = workflow.jobs["build-desktop"].steps.find((step) => step.id === "collect");
const bash = process.env.BASH_PATH || "bash";

function render(value, matrix) {
  return value.replace(/\$\{\{\s*matrix\.([\w-]+)\s*\}\}/g, (_, key) => matrix[key]);
}

async function fixture(t, extensions) {
  const directory = await mkdtemp(join(tmpdir(), "zcode release artifacts "));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const dist = join(directory, "packages", "desktop", "dist");
  await mkdir(dist, { recursive: true });
  const names = extensions.map((extension) => `ZCode portable 1.0.0${extension}`);
  for (const name of names) {
    await writeFile(join(dist, name), `artifact:${name}`);
  }
  // 仓库根目录的 zip 不能冒充 dist 中的 portable 产物。
  await writeFile(join(directory, "unrelated.zip"), "not a desktop release");
  return { directory, names };
}

function runCollect(directory, os, extensions) {
  const matrix = { os, "artifact-exts": extensions.map((extension) => `*${extension}`).join(" ") };
  const stepEnv = Object.fromEntries(
    Object.entries(collect.env ?? {}).map(([key, value]) => [key, render(value, matrix)]),
  );
  return execFileAsync(
    bash,
    ["--noprofile", "--norc", "-e", "-o", "pipefail", "-c", render(collect.run, matrix)],
    {
      cwd: directory,
      env: { ...process.env, ...stepEnv },
    },
  );
}

for (const [os, extensions] of [
  ["win", [".exe", ".zip"]],
  ["mac", [".dmg", ".zip"]],
  ["linux", [".AppImage", ".deb"]],
]) {
  test(`${os} collects both dist artifacts and excludes unrelated root files`, async (t) => {
    const { directory, names } = await fixture(t, extensions);
    await runCollect(directory, os, extensions);
    assert.deepEqual((await readdir(join(directory, "artifacts"))).sort(), names.toSorted());
    for (const name of names) {
      assert.equal(await readFile(join(directory, "artifacts", name), "utf8"), `artifact:${name}`);
    }
  });

  for (const missing of extensions) {
    test(`${os} fails when ${missing} is absent even if other artifacts exist`, async (t) => {
      const { directory } = await fixture(
        t,
        extensions.filter((extension) => extension !== missing),
      );
      // 匹配扩展名的目录也不能满足产物完整性要求。
      await mkdir(join(directory, "packages", "desktop", "dist", `directory${missing}`));
      await assert.rejects(runCollect(directory, os, extensions), (error) => {
        assert.equal(error.code, 1);
        assert.ok(error.stderr.includes(`*${missing}`));
        return true;
      });
    });
  }

  test(`${os} fails when dist is empty`, async (t) => {
    const { directory } = await fixture(t, []);
    await assert.rejects(runCollect(directory, os, extensions), { code: 1 });
  });
}
