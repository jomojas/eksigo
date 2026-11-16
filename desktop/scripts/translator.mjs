// Builds the phrase translator (translate/) and puts it where Tauri bundles it from:
// src-tauri/binaries/eksigo-translate-<target triple>, as `bundle.externalBin` asks.
//
//   node scripts/translator.mjs                         this computer's own triple
//   node scripts/translator.mjs universal-apple-darwin  both Mac processors in one file (the release)
//
// Tauri also passes the triple it's building for in TAURI_ENV_TARGET_TRIPLE.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const crate = join(root, "translate");
const out = join(root, "src-tauri", "binaries");
const host = /host: (\S+)/.exec(execFileSync("rustc", ["-vV"], { encoding: "utf8" }))[1];
const triple = process.argv[2] || process.env.TAURI_ENV_TARGET_TRIPLE || host;

function build(t) {
  const env = { ...process.env };
  // The same processor baseline as whisper.cpp in the release (AVX2 and FMA, on almost every PC since 2015);
  // llama.cpp takes its CPU features from Rust's.
  if (t.startsWith("x86_64")) env.RUSTFLAGS = `${env.RUSTFLAGS ?? ""} -C target-feature=+avx,+avx2,+fma,+f16c,+sse4.2`.trim();
  // With Rust's static C runtime (the Windows release), llama.cpp has to use it too. Its CMake project picks the
  // runtime with CMAKE_MSVC_RUNTIME_LIBRARY (policy CMP0091), not compiler flags, so LLAMA_STATIC_CRT alone isn't
  // enough; llama-cpp-sys-2 passes CMAKE_* variables on to CMake.
  if ((env.RUSTFLAGS ?? "").includes("crt-static")) {
    env.LLAMA_STATIC_CRT = "1";
    env.CMAKE_MSVC_RUNTIME_LIBRARY = "MultiThreaded";
  }
  console.log(`translator: building for ${t}`);
  execFileSync("cargo", ["build", "--release", "--locked", "--manifest-path", join(crate, "Cargo.toml"), "--target", t], { stdio: "inherit", env });
  return join(crate, "target", t, "release", t.includes("windows") ? "eksigo-translate.exe" : "eksigo-translate");
}

mkdirSync(out, { recursive: true });
if (triple === "universal-apple-darwin") {
  // Tauri builds the app once per processor, each wanting its own translator, then joins them: so all three.
  const targets = ["aarch64-apple-darwin", "x86_64-apple-darwin"];
  const parts = targets.map(build);
  targets.forEach((t, i) => copyFileSync(parts[i], join(out, `eksigo-translate-${t}`)));
  execFileSync("lipo", ["-create", "-output", join(out, `eksigo-translate-${triple}`), ...parts], { stdio: "inherit" });
} else {
  copyFileSync(build(triple), join(out, `eksigo-translate-${triple}${triple.includes("windows") ? ".exe" : ""}`));
}
console.log(`translator: ready in src-tauri/binaries for ${triple}`);
