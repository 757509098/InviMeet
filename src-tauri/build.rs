fn main() {
    #[cfg(target_os = "macos")]
    {
        let out_dir = std::env::var("OUT_DIR").unwrap();
        let swift_file = "src/audio/mac_loopback.swift";
        let lib_path = format!("{}/libmac_loopback.a", out_dir);
        let cache_dir = format!("{}/swift_cache", out_dir);
        let _ = std::fs::create_dir_all(&cache_dir);

        println!("cargo:rerun-if-changed={}", swift_file);

        let status = std::process::Command::new("swiftc")
            .args(&[
                "-module-cache-path",
                &cache_dir,
                "-emit-library",
                "-static",
                swift_file,
                "-o",
                &lib_path,
            ])
            .status()
            .expect("Failed to execute swiftc compiler");

        if !status.success() {
            panic!("Failed to compile mac_loopback.swift with swiftc");
        }

        println!("cargo:rustc-link-search=native={}", out_dir);
        println!("cargo:rustc-link-lib=static=mac_loopback");
        println!("cargo:rustc-link-lib=framework=ScreenCaptureKit");
        println!("cargo:rustc-link-lib=framework=AVFoundation");
        println!("cargo:rustc-link-lib=framework=CoreMedia");
        println!("cargo:rustc-link-lib=framework=CoreAudio");
        println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
    }

    tauri_build::build()
}

