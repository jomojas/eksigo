fn main() {
    // whisper.cpp's Metal code asks which macOS it runs on (`@available`), which compiles to a call into clang's
    // runtime library. Rust doesn't link that library, so linking fails whenever the app targets a macOS older
    // than the build machine's, as releases do (macOS 11). Link it from the compiler that built whisper.cpp.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        let out = std::process::Command::new("xcrun").args(["clang", "-print-resource-dir"]).output();
        if let Ok(out) = out {
            let dir = std::path::PathBuf::from(String::from_utf8_lossy(&out.stdout).trim()).join("lib/darwin");
            if dir.join("libclang_rt.osx.a").exists() {
                println!("cargo:rustc-link-search=native={}", dir.display());
                println!("cargo:rustc-link-lib=static=clang_rt.osx");
            }
        }
    }
    tauri_build::build()
}
