pub mod asr;
pub mod audio;
pub mod commands;
pub mod llm;
pub mod models;
pub mod storage;

use commands::AppState;
use models::RecordingState;
use tauri::Manager;
use tokio::sync::Mutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    println!("[InviMeet Rust] Starting InviMeet application runtime...");

    let initial_state = AppState {
        audio_engine: audio::AudioEngine::new(),
        store: storage::MeetingStore::new(),
        asr_engine: std::sync::Arc::new(asr::AsrEngine::new()),
        recording_state: Mutex::new(RecordingState {
            is_recording: false,
            is_paused: false,
            duration_seconds: 0,
            active_meeting_id: None,
            mic_level: 0.0,
            speaker_level: 0.0,
        }),
    };

    println!("[InviMeet Rust] AppState initialized successfully.");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .on_page_load(|webview, payload| {
            println!(
                "[InviMeet Rust PageLoad] window='{}', event={:?}, url={}",
                webview.label(),
                payload.event(),
                payload.url()
            );
        })
        .manage(initial_state)
        .setup(|app| {
            println!("[InviMeet Rust] Tauri setup hook executed.");

            #[cfg(debug_assertions)]
            {
                let is_server_running = std::net::TcpStream::connect_timeout(
                    &"127.0.0.1:5173".parse().unwrap(),
                    std::time::Duration::from_millis(600),
                )
                .is_ok();

                if is_server_running {
                    println!("[InviMeet Rust] 成功检测到前端服务运行在 http://127.0.0.1:5173");
                } else {
                    eprintln!("[InviMeet Rust 警告] 前端服务 (http://127.0.0.1:5173) 暂未响应，请确保 pnpm dev / pnpm tauri dev 已正常启动。");
                }
            }

            if let Some(main_win) = app.get_webview_window("main") {
                let is_visible = main_win.is_visible().unwrap_or(false);
                let title = main_win.title().unwrap_or_default();
                let url = main_win.url();
                println!(
                    "[InviMeet Rust] Window 'main' found: title='{}', visible={}, target_url={:?}",
                    title, is_visible, url
                );
            } else {
                eprintln!("[InviMeet Rust ERROR] Window 'main' was not found in AppHandle!");
            }

            if let Some(_pill_win) = app.get_webview_window("pill") {
                println!("[InviMeet Rust] Window 'pill' registered.");
                #[cfg(debug_assertions)]
                {
                    // pill_win.open_devtools();
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::start_recording,
            commands::stop_recording,
            commands::get_recording_state,
            commands::get_audio_devices,
            commands::check_audio_permissions,
            commands::request_audio_permissions,
            commands::check_asr_model_status,
            commands::download_asr_model,
            commands::get_meetings,
            commands::get_meeting_detail,
            commands::generate_summary,
            commands::check_ollama_status,
            commands::open_main_window,
            commands::toggle_pill_window,
            commands::read_audio_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running InviMeet Tauri application");
}
