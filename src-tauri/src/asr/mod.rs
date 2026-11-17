pub mod model_manager;
pub mod vad;

use tauri::AppHandle;
use uuid::Uuid;

use crate::models::{SpeakerRole, TranscriptSegment};
pub use model_manager::{AsrModelStatus, ModelDownloadProgress, ModelManager};
pub use vad::{AudioChunk, AudioChunker};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AsrMode {
    SenseVoiceSmall,
    CloudApi,
    MockDemo,
}

extern "C" {
    fn asr_recognizer_create(
        model_path: *const std::os::raw::c_char,
        tokens_path: *const std::os::raw::c_char,
        num_threads: std::os::raw::c_int,
    ) -> *mut std::os::raw::c_void;

    fn asr_recognizer_transcribe(
        recognizer: *mut std::os::raw::c_void,
        samples: *const f32,
        num_samples: std::os::raw::c_int,
        sample_rate: std::os::raw::c_int,
    ) -> *mut std::os::raw::c_char;

    fn asr_recognizer_free_string(str: *mut std::os::raw::c_char);

    fn asr_recognizer_destroy(recognizer: *mut std::os::raw::c_void);
}

/// Safe thread-aware wrapper for resident Sherpa-ONNX offline recognizer
pub struct ResidentRecognizer {
    handle: *mut std::os::raw::c_void,
}

unsafe impl Send for ResidentRecognizer {}
unsafe impl Sync for ResidentRecognizer {}

impl ResidentRecognizer {
    pub fn new(model_path: &str, tokens_path: &str, num_threads: i32) -> Result<Self, String> {
        let c_model = std::ffi::CString::new(model_path).map_err(|e| e.to_string())?;
        let c_tokens = std::ffi::CString::new(tokens_path).map_err(|e| e.to_string())?;
        let handle = unsafe { asr_recognizer_create(c_model.as_ptr(), c_tokens.as_ptr(), num_threads) };
        if handle.is_null() {
            Err("无法初始化 Sherpa-ONNX 常驻内存推理实例".to_string())
        } else {
            Ok(Self { handle })
        }
    }

    pub fn transcribe(&self, samples: &[f32], sample_rate: u32) -> Option<String> {
        if self.handle.is_null() || samples.is_empty() {
            return None;
        }
        let c_str = unsafe {
            asr_recognizer_transcribe(
                self.handle,
                samples.as_ptr(),
                samples.len() as std::os::raw::c_int,
                sample_rate as std::os::raw::c_int,
            )
        };
        if c_str.is_null() {
            return None;
        }
        let result = unsafe {
            let slice = std::ffi::CStr::from_ptr(c_str);
            let s = slice.to_string_lossy().to_string();
            asr_recognizer_free_string(c_str);
            s
        };
        Some(result)
    }
}

impl Drop for ResidentRecognizer {
    fn drop(&mut self) {
        if !self.handle.is_null() {
            unsafe {
                asr_recognizer_destroy(self.handle);
            }
            self.handle = std::ptr::null_mut();
        }
    }
}

pub struct AsrEngine {
    pub mode: AsrMode,
    resident: std::sync::Mutex<Option<ResidentRecognizer>>,
}

impl AsrEngine {
    pub fn new() -> Self {
        Self {
            mode: AsrMode::SenseVoiceSmall,
            resident: std::sync::Mutex::new(None),
        }
    }

    /// Clean SenseVoice special tokens like `<|zh|>`, `<|NEUTRAL|>`, `<|Speech|>`, `<|withitn|>`
    pub fn clean_sense_voice_text(raw: &str) -> String {
        let mut result = String::with_capacity(raw.len());
        let mut in_tag = false;
        for ch in raw.chars() {
            if ch == '<' {
                in_tag = true;
            } else if ch == '>' && in_tag {
                in_tag = false;
            } else if !in_tag {
                result.push(ch);
            }
        }
        result.trim().to_string()
    }

    /// Transcribe an audio chunk (16kHz mono Float32 PCM) with speaker tagging
    pub async fn transcribe_chunk(
        &self,
        chunk: &AudioChunk,
        meeting_id: &str,
        app: &AppHandle,
    ) -> Option<TranscriptSegment> {
        let duration_secs = chunk.samples.len() as f32 / 16_000.0;
        if duration_secs < 0.35 {
            return None; // Skip micro-artifacts shorter than 350ms
        }

        let speaker_label = match chunk.speaker {
            SpeakerRole::Me => "我".to_string(),
            SpeakerRole::Remote => "参会对方".to_string(),
        };

        let status = ModelManager::check_status(app);

        let text = if status.is_ready {
            if let (Some(onnx_path), Some(tokens_path)) = (&status.model_file, &status.tokens_file) {
                // Priority 1: Use persistent in-memory resident recognizer (Zero cold-start)
                let recognized_res = {
                    let mut guard = self.resident.lock().unwrap_or_else(|e| e.into_inner());
                    if guard.is_none() {
                        let t0 = std::time::Instant::now();
                        match ResidentRecognizer::new(onnx_path, tokens_path, 4) {
                            Ok(rec) => {
                                println!(
                                    "[InviMeet ASR] 常驻模型首次加载就绪，耗时: {:.1}ms",
                                    t0.elapsed().as_secs_f64() * 1000.0
                                );
                                *guard = Some(rec);
                            }
                            Err(e) => {
                                eprintln!("[InviMeet ASR 警告] 无法初始化常驻模型: {}", e);
                            }
                        }
                    }

                    if let Some(rec) = guard.as_ref() {
                        let t_infer = std::time::Instant::now();
                        let text_opt = rec.transcribe(&chunk.samples, 16000);
                        if let Some(t) = text_opt {
                            println!(
                                "[InviMeet ASR 常驻推理] {:.2}s 音频在 {:.1}ms 内完成转录 (角色={:?})",
                                duration_secs,
                                t_infer.elapsed().as_secs_f64() * 1000.0,
                                chunk.speaker
                            );
                            Ok(t)
                        } else {
                            Err("常驻模型推理返回空文本".to_string())
                        }
                    } else {
                        // Priority 2: Fallback to CLI subprocess runner if resident failed
                        println!("[InviMeet ASR] 降级至 CLI 命令行推理...");
                        Self::run_sense_voice_inference(onnx_path, tokens_path, &chunk.samples, app)
                    }
                };

                match recognized_res {
                    Ok(raw_text) => {
                        let cleaned = Self::clean_sense_voice_text(&raw_text);

                        // Content check to reject ambient noise hallucinations:
                        // Must contain at least 1 Chinese character or 3+ English alphanumeric chars
                        let has_cjk = cleaned.chars().any(|c| ('\u{4e00}'..='\u{9fa5}').contains(&c));
                        let alnum_count = cleaned.chars().filter(|c| c.is_alphanumeric()).count();

                        if (!has_cjk && alnum_count < 3) || alnum_count == 0 {
                            println!("[InviMeet ASR] 智能过滤非人声杂音/标点碎片: raw='{}'", raw_text);
                            return None;
                        }

                        cleaned
                    }
                    Err(err) => {
                        eprintln!("[InviMeet ASR 推理异常] {}", err);
                        return None;
                    }
                }
            } else {
                format!("{} 发言（{:.1}秒）", speaker_label, duration_secs)
            }
        } else {
            // Model not ready: informative prompt for user to download in Settings
            format!(
                "{} 发言（{:.1}秒，SenseVoice 离线模型未就绪，请在“设置”中下载）",
                speaker_label, duration_secs
            )
        };

        Some(TranscriptSegment {
            id: format!("seg-{}", Uuid::new_v4()),
            meeting_id: meeting_id.to_string(),
            speaker: chunk.speaker.clone(),
            speaker_label,
            text,
            timestamp_ms: chunk.start_timestamp_ms,
            confidence: Some(0.96),
        })
    }

    fn write_temp_wav(samples: &[f32], path: &std::path::Path) -> Result<(), String> {
        let spec = hound::WavSpec {
            channels: 1,
            sample_rate: 16000,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let mut writer = hound::WavWriter::create(path, spec).map_err(|e| e.to_string())?;
        for &s in samples {
            let clamped = s.max(-1.0).min(1.0);
            let val = (clamped * 32767.0) as i16;
            writer.write_sample(val).map_err(|e| e.to_string())?;
        }
        writer.finalize().map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Run SenseVoice inference via sherpa-onnx-offline
    fn run_sense_voice_inference(
        model_path: &str,
        tokens_path: &str,
        samples: &[f32],
        app: &AppHandle,
    ) -> Result<String, String> {
        let model_dir = ModelManager::get_model_dir(app);

        let candidate_bins = [
            model_dir.join("engine").join("bin").join("sherpa-onnx-offline"),
            std::path::PathBuf::from("src-tauri/bin/engine/bin/sherpa-onnx-offline"),
            std::path::PathBuf::from("engine/bin/sherpa-onnx-offline"),
        ];

        let mut engine_path = None;
        for c in &candidate_bins {
            if c.exists() {
                engine_path = Some(c.clone());
                break;
            }
        }

        let engine = engine_path.unwrap_or_else(|| std::path::PathBuf::from("sherpa-onnx-offline"));

        // Create unique temporary wav file in system temp
        let temp_wav = std::env::temp_dir().join(format!("invimeet_chunk_{}.wav", Uuid::new_v4()));
        Self::write_temp_wav(samples, &temp_wav)?;

        let mut cmd = std::process::Command::new(&engine);
        cmd.arg(format!("--tokens={}", tokens_path))
            .arg(format!("--sense-voice-model={}", model_path))
            .arg("--sense-voice-language=auto")
            .arg("--sense-voice-use-itn=true")
            .arg("--num-threads=2")
            .arg(&temp_wav);

        // Ensure dynamic libraries (libonnxruntime.dylib) can be resolved
        if let Some(parent) = engine.parent() {
            let lib_dir = parent.parent().unwrap_or(parent).join("lib");
            if lib_dir.exists() {
                #[cfg(target_os = "macos")]
                cmd.env("DYLD_LIBRARY_PATH", &lib_dir);
                #[cfg(target_os = "linux")]
                cmd.env("LD_LIBRARY_PATH", &lib_dir);
                #[cfg(target_os = "windows")]
                {
                    if let Some(path_var) = std::env::var_os("PATH") {
                        let mut new_path = std::ffi::OsString::from(&lib_dir);
                        new_path.push(";");
                        new_path.push(path_var);
                        cmd.env("PATH", new_path);
                    }
                }
            }
        }

        let output = cmd.output();
        let _ = std::fs::remove_file(&temp_wav);

        match output {
            Ok(out) => {
                let stdout = String::from_utf8_lossy(&out.stdout);
                for line in stdout.lines() {
                    let trimmed = line.trim();
                    if trimmed.starts_with('{') && trimmed.ends_with('}') {
                        if let Ok(val) = serde_json::from_str::<serde_json::Value>(trimmed) {
                            if let Some(text_str) = val.get("text").and_then(|t| t.as_str()) {
                                return Ok(text_str.to_string());
                            }
                        }
                    }
                }
                Ok(String::new())
            }
            Err(e) => Err(format!("无法调用 sherpa-onnx-offline 推理引擎: {}", e)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_resident_recognizer_lifecycle() {
        let home = std::env::var("HOME").unwrap_or_default();
        let model_path = format!("{}/Library/Application Support/com.invimeet.app/models/sense-voice-small/model.int8.onnx", home);
        let tokens_path = format!("{}/Library/Application Support/com.invimeet.app/models/sense-voice-small/tokens.txt", home);

        if std::path::Path::new(&model_path).exists() && std::path::Path::new(&tokens_path).exists() {
            let start_t = std::time::Instant::now();
            let rec = ResidentRecognizer::new(&model_path, &tokens_path, 2)
                .expect("Failed to create resident recognizer");
            println!("Resident model created in {:.2}ms", start_t.elapsed().as_secs_f64() * 1000.0);

            // Test 1 second of dummy audio samples
            let samples = vec![0.0f32; 16000];
            let infer_t = std::time::Instant::now();
            let result = rec.transcribe(&samples, 16000);
            println!("Transcribe finished in {:.2}ms, output={:?}", infer_t.elapsed().as_secs_f64() * 1000.0, result);
            assert!(result.is_some());
        }
    }
}

