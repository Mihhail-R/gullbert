mod action_catalog;
use std::{env, path::PathBuf};
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
    tauri_build::build()
}
