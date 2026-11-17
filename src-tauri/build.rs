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
        // Compile and link ASR C-Bridge for resident in-memory SenseVoice ASR
        let asr_c_file = "src/asr/asr_bridge.c";
        let asr_lib_path = format!("{}/libasr_bridge.a", out_dir);
        let asr_o_path = format!("{}/asr_bridge.o", out_dir);
        println!("cargo:rerun-if-changed={}", asr_c_file);
        println!("cargo:rerun-if-changed=src/asr/asr_bridge.h");

        let engine_dir = std::path::Path::new("bin/engine");
        let engine_include = engine_dir.join("include");
        let engine_lib = engine_dir.join("lib");
        let engine_lib_abs = std::fs::canonicalize(&engine_lib).unwrap_or(engine_lib.clone());

        let clang_status = std::process::Command::new("clang")
            .args(&[
                "-O3",
                "-c",
                asr_c_file,
                "-I",
                engine_include.to_str().unwrap(),
                "-o",
                &asr_o_path,
            ])
            .status()
            .expect("Failed to compile asr_bridge.c with clang");

        if !clang_status.success() {
            panic!("Failed to compile asr_bridge.c");
        }

        let ar_status = std::process::Command::new("ar")
            .args(&["rcs", &asr_lib_path, &asr_o_path])
            .status()
            .expect("Failed to create libasr_bridge.a with ar");

        if !ar_status.success() {
            panic!("Failed to create libasr_bridge.a");
        }

        println!("cargo:rustc-link-lib=static=asr_bridge");
        println!("cargo:rustc-link-search=native={}", engine_lib_abs.display());
        println!("cargo:rustc-link-lib=dylib=sherpa-onnx-c-api");
        println!("cargo:rustc-link-arg=-Wl,-rpath,{}", engine_lib_abs.display());
        println!("cargo:rustc-link-arg=-Wl,-rpath,@loader_path/bin/engine/lib");
        println!("cargo:rustc-link-arg=-Wl,-rpath,@executable_path/bin/engine/lib");
        println!("cargo:rustc-link-arg=-Wl,-rpath,@executable_path/../Resources/bin/engine/lib");
        println!("cargo:rustc-link-arg=-Wl,-rpath,@executable_path/../Frameworks");
    }

    tauri_build::build()
}

