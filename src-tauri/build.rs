use std::{env, path::PathBuf, process::Command};
fn main() {
    if env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        use sha2::{Digest, Sha256};
        println!("cargo:rerun-if-changed=models/manifest.json");
        let manifest: serde_json::Value =
            serde_json::from_str(include_str!("models/manifest.json")).unwrap();
        for model in manifest["models"].as_array().unwrap() {
            let path = format!("models/{}", model["file"].as_str().unwrap());
            println!("cargo:rerun-if-changed={path}");
            let bytes = std::fs::read(&path)
                .expect("Run npm run prepare:vision before building Windows OCR");
            assert_eq!(
                format!("{:x}", Sha256::digest(&bytes)),
                model["sha256"].as_str().unwrap(),
                "OCR model checksum mismatch; run npm run prepare:vision"
            );
        }
    }
    println!("cargo:rerun-if-changed=native/vision.m");
    if env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        let out = PathBuf::from(env::var_os("OUT_DIR").unwrap());
        let arch = match env::var("CARGO_CFG_TARGET_ARCH").unwrap().as_str() {
            "aarch64" => "arm64",
            "x86_64" => "x86_64",
            other => panic!("Unsupported Mac architecture: {other}"),
        };
        let status = Command::new("xcrun")
            .args([
                "clang",
                "-arch",
                arch,
                "-mmacosx-version-min=11.0",
                "-fobjc-arc",
                "-O2",
                "-c",
                "native/vision.m",
                "-o",
            ])
            .arg(out.join("vision.o"))
            .status()
            .expect("Apple clang is required for local vision");
        assert!(status.success(), "Could not compile local vision");
        let status = Command::new("ar")
            .arg("crs")
            .arg(out.join("libgullbert_vision.a"))
            .arg(out.join("vision.o"))
            .status()
            .unwrap();
        assert!(status.success(), "Could not archive local vision");
        println!("cargo:rustc-link-search=native={}", out.display());
        println!("cargo:rustc-link-lib=static=gullbert_vision");
        println!("cargo:rustc-link-lib=framework=AppKit");
        println!("cargo:rustc-link-lib=framework=Vision");
        println!("cargo:rustc-link-lib=framework=CoreGraphics");
        println!("cargo:rustc-link-arg=-Wl,-weak_framework,ScreenCaptureKit");
        // Rust release linking disables Clang's default runtime libraries.
        // Objective-C availability checks need its platform-version helper.
        let resource = Command::new("xcrun")
            .args(["clang", "-print-resource-dir"])
            .output()
            .expect("Could not locate Apple clang's runtime");
        assert!(resource.status.success());
        let resource = String::from_utf8(resource.stdout).unwrap();
        println!(
            "cargo:rustc-link-search=native={}/lib/darwin",
            resource.trim()
        );
        println!("cargo:rustc-link-lib=static=clang_rt.osx");
    }
    tauri_build::build()
}
