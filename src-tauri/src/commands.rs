use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::Mutex;
use chrono::Utc;
use uuid::Uuid;

use crate::models::{AudioDeviceInfo, Meeting, MeetingSummary, RecordingState};
use crate::audio::AudioEngine;
use crate::storage::MeetingStore;
use crate::llm::{LlmClient, LlmConfig, OllamaStatus};
use crate::asr::{AsrEngine, AsrModelStatus, ModelManager};

pub struct AppState {
    pub audio_engine: AudioEngine,
    pub store: MeetingStore,
    pub asr_engine: std::sync::Arc<AsrEngine>,
    pub recording_state: Mutex<RecordingState>,
}

#[tauri::command]
pub async fn start_recording(
    app: AppHandle,
    title: Option<String>,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let meeting_id = format!("meet-{}", Uuid::new_v4());
    let meeting_title = title.unwrap_or_else(|| format!("会议记录 {}", Utc::now().format("%Y-%m-%d %H:%M")));

    // App data directory for saving 16kHz WAV files
    let base_dir = app.path().app_data_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));

    // Create channel for real-time speech chunks
    let (chunk_tx, mut chunk_rx) = tokio::sync::mpsc::channel(128);

    // 1. Start audio engine capture (mic + loopback)
    state
        .audio_engine
        .start_capture(meeting_id.clone(), base_dir, chunk_tx, app.clone())
        .await?;

    // 2. Spawn real-time ASR worker task
    let asr_app = app.clone();
    let asr_store = state.store.clone();
    let asr_engine = state.asr_engine.clone();
    let asr_meeting_id = meeting_id.clone();

    tokio::spawn(async move {
        println!("[InviMeet ASR] 实时双轨 ASR 监听任务已启动，正在监听语音输入...");
        while let Some(chunk) = chunk_rx.recv().await {
            let dur = chunk.samples.len() as f32 / 16_000.0;
            println!("[InviMeet ASR] 捕获到人声切片: 角色={:?}, 时长={:.2}s", chunk.speaker, dur);
            if let Some(segment) = asr_engine.transcribe_chunk(&chunk, &asr_meeting_id, &asr_app).await {
                println!("[InviMeet ASR] 广播转录文本气泡: [{}] {}", segment.speaker_label, segment.text);
                let _ = asr_app.emit("transcript-segment", &segment);
                asr_store.add_segment(&asr_meeting_id, segment).await;
            }
        }
    });

    // 3. Initialize new meeting record
    let new_meeting = Meeting {
        id: meeting_id.clone(),
        title: meeting_title,
        created_at: Utc::now().to_rfc3339(),
        duration_seconds: 0,
        segments: Vec::new(),
        summary: None,
        tags: vec!["实时录制".to_string()],
        audio_file_mic: None,
        audio_file_speaker: None,
    };
    state.store.insert(new_meeting).await;

    // 4. Update recording state
    let mut rec_guard = state.recording_state.lock().await;
    rec_guard.is_recording = true;
    rec_guard.is_paused = false;
    rec_guard.duration_seconds = 0;
    rec_guard.active_meeting_id = Some(meeting_id.clone());

    // Broadcast state update to all webview windows (main + pill)
    let _ = app.emit("recording-state-changed", &*rec_guard);

    Ok(serde_json::json!({ "meetingId": meeting_id }))
}

#[tauri::command]
pub async fn stop_recording(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<Meeting>, String> {
    let (mic_file, speaker_file, duration) = state.audio_engine.stop_capture().await?;

    let mut rec_guard = state.recording_state.lock().await;
    let active_id = rec_guard.active_meeting_id.take();
    rec_guard.is_recording = false;
    rec_guard.is_paused = false;
    rec_guard.duration_seconds = 0;
    rec_guard.mic_level = 0.0;
    rec_guard.speaker_level = 0.0;

    // Broadcast stopped state and clear audio levels across windows
    let _ = app.emit("recording-state-changed", &*rec_guard);
    let _ = app.emit(
        "audio-level",
        serde_json::json!({ "micLevel": 0.0, "speakerLevel": 0.0, "durationSeconds": 0 }),
    );

    if let Some(id) = active_id {
        if let Some(mut meeting) = state.store.get(&id).await {
            meeting.duration_seconds = duration;
            meeting.audio_file_mic = mic_file;
            meeting.audio_file_speaker = speaker_file;
            state.store.update_meeting(meeting.clone()).await;
            return Ok(Some(meeting));
        }
    }

    Ok(None)
}

#[tauri::command]
pub async fn get_recording_state(state: State<'_, AppState>) -> Result<RecordingState, String> {
    let mut guard = state.recording_state.lock().await;
    if guard.is_recording {
        guard.duration_seconds = state.audio_engine.get_duration_seconds();
    }
    Ok(guard.clone())
}

#[tauri::command]
pub async fn get_audio_devices(state: State<'_, AppState>) -> Result<Vec<AudioDeviceInfo>, String> {
    Ok(state.audio_engine.list_devices())
}

#[tauri::command]
pub async fn get_meetings(state: State<'_, AppState>) -> Result<Vec<Meeting>, String> {
    Ok(state.store.list().await)
}

#[tauri::command]
pub async fn get_meeting_detail(
    id: String,
    state: State<'_, AppState>,
) -> Result<Option<Meeting>, String> {
    Ok(state.store.get(&id).await)
}

#[tauri::command]
pub async fn generate_summary(
    meeting_id: String,
    config: Option<LlmConfig>,
    state: State<'_, AppState>,
) -> Result<MeetingSummary, String> {
    let meeting = state
        .store
        .get(&meeting_id)
        .await
        .ok_or_else(|| "Meeting not found".to_string())?;

    let llm_client = match config {
        Some(ref cfg) => LlmClient::from_config(cfg),
        None => LlmClient::new(
            "ollama".to_string(),
            "".to_string(),
            "http://127.0.0.1:11434".to_string(),
            "qwen2.5:7b".to_string(),
        ),
    };

    let summary = llm_client.summarize(&meeting).await?;
    state.store.update_summary(&meeting_id, summary.clone()).await;

    Ok(summary)
}

#[tauri::command]
pub async fn check_ollama_status(url: Option<String>) -> Result<OllamaStatus, String> {
    let target = url.unwrap_or_else(|| "http://127.0.0.1:11434".to_string());
    Ok(LlmClient::check_ollama(&target).await)
}

#[tauri::command]
pub async fn open_main_window(app: AppHandle) -> Result<(), String> {
    if let Some(main_win) = app.get_webview_window("main") {
        main_win.show().map_err(|e| e.to_string())?;
        main_win.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn toggle_pill_window(app: AppHandle) -> Result<(), String> {
    if let Some(pill_win) = app.get_webview_window("pill") {
        let is_visible = pill_win.is_visible().unwrap_or(false);
        if is_visible {
            pill_win.hide().map_err(|e| e.to_string())?;
        } else {
            pill_win.show().map_err(|e| e.to_string())?;
            pill_win.set_focus().map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioPermissionsState {
    pub has_screen_capture_permission: bool,
    pub platform: String,
}

#[tauri::command]
pub async fn check_audio_permissions() -> Result<AudioPermissionsState, String> {
    let has_screen = AudioEngine::check_screen_capture_permission();
    let platform = std::env::consts::OS.to_string();
    Ok(AudioPermissionsState {
        has_screen_capture_permission: has_screen,
        platform,
    })
}

#[tauri::command]
pub async fn request_audio_permissions() -> Result<bool, String> {
    let granted = AudioEngine::request_screen_capture_permission();
    if !granted {
        #[cfg(target_os = "macos")]
        {
            let _ = std::process::Command::new("open")
                .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")
                .spawn();
        }
    }
    Ok(granted)
}

#[tauri::command]
pub async fn check_asr_model_status(app: AppHandle) -> Result<AsrModelStatus, String> {
    Ok(ModelManager::check_status(&app))
}

#[tauri::command]
pub async fn download_asr_model(app: AppHandle) -> Result<(), String> {
    ModelManager::download_model(app).await
}


