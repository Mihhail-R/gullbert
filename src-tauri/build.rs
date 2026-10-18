mod action_catalog;
use std::{env, path::PathBuf, process::Command};

fn main() {
    println!("cargo:rerun-if-changed=../src/actions/catalog.json");
    println!("cargo:rerun-if-changed=action_catalog.rs");
    let source = std::fs::read_to_string("../src/actions/catalog.json").unwrap();
    let generated = action_catalog::generate(&source).expect("Invalid action catalog");
    std::fs::write(
        PathBuf::from(env::var_os("OUT_DIR").unwrap()).join("actions.rs"),
        generated,
    )
    .unwrap();

    if env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        build_work_activity();
    }

    tauri_build::build();
}

fn build_work_activity() {
    println!("cargo:rerun-if-changed=native/work_activity.m");
    println!("cargo:rerun-if-changed=native/work_activity.h");
    let out = PathBuf::from(env::var_os("OUT_DIR").unwrap());
    let arch = match env::var("CARGO_CFG_TARGET_ARCH").unwrap().as_str() {
        "aarch64" => "arm64",
        "x86_64" => "x86_64",
        other => panic!("Unsupported Mac architecture: {other}"),
    };
    let compiled = Command::new("xcrun")
        .args([
            "clang",
            "-arch",
            arch,
            "-mmacosx-version-min=12.3",
            "-fobjc-arc",
            "-Wall",
            "-Wextra",
            "-Werror",
            "-O2",
            "-c",
            "native/work_activity.m",
            "-o",
        ])
        .arg(out.join("work_activity.o"))
        .status()
        .expect("Apple clang is required for work activity");
    assert!(compiled.success(), "Could not compile work activity");

    let archived = Command::new("ar")
        .arg("crs")
        .arg(out.join("libgullbert_work.a"))
        .arg(out.join("work_activity.o"))
        .status()
        .expect("Could not run ar");
    assert!(archived.success(), "Could not archive work activity");

    println!("cargo:rustc-link-search=native={}", out.display());
    println!("cargo:rustc-link-lib=static=gullbert_work");
    println!("cargo:rustc-link-lib=framework=AppKit");
    println!("cargo:rustc-link-lib=framework=Carbon");
    println!("cargo:rustc-link-lib=framework=CoreGraphics");
}
