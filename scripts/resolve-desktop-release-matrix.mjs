import { appendFile } from "node:fs/promises";

const platforms = [
  {
    os: "mac",
    runner: "macos-latest",
    "default-arch": "arm64",
    "targets-env": "",
    "build-targets": "dmg,zip",
    "artifact-exts": "*.dmg *.zip",
  },
  {
    os: "win",
    runner: "windows-latest",
    "default-arch": "x64",
    "targets-env": "nsis,zip",
    "build-targets": "nsis,zip",
    "artifact-exts": "*.exe *.zip",
  },
  {
    os: "linux",
    runner: "ubuntu-latest",
    "default-arch": "x64",
    "targets-env": "AppImage,deb",
    "build-targets": "AppImage,deb",
    "artifact-exts": "*.AppImage *.deb",
  },
];

// job 级 if 在矩阵展开前求值，不能读取 matrix；必须先筛选再交给构建 job 展开。
const selectedOs = process.env.GITHUB_EVENT_NAME === "push" ? "all" : process.env.RELEASE_OS;
const include = platforms.filter(({ os }) => selectedOs === "all" || os === selectedOs);
if (include.length === 0) {
  throw new Error(`Unsupported release platform: ${selectedOs}`);
}

await appendFile(process.env.GITHUB_OUTPUT, `matrix=${JSON.stringify({ include })}\n`);
