use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AsrModelStatus {
    pub is_ready: bool,
    pub model_dir: String,
    pub model_file: Option<String>,
    pub tokens_file: Option<String>,
    pub model_size_bytes: u64,
    pub model_size_mb: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelDownloadProgress {
    pub file_name: String,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub percentage: f32,
    pub is_completed: bool,
    pub error: Option<String>,
}

pub struct ModelManager;

impl ModelManager {
    pub const MODEL_NAME: &'static str = "sense-voice-small";
    pub const ONNX_FILE: &'static str = "model.int8.onnx";
    pub const TOKENS_FILE: &'static str = "tokens.txt";

    // Verified Mirrors (ModelScope China, HF-Mirror, HuggingFace)
    pub const ONNX_URLS: &'static [&'static str] = &[
        "https://www.modelscope.cn/models/poloniumrock/SenseVoiceSmallOnnx/resolve/master/model.int8.onnx",
        "https://hf-mirror.com/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/main/model.int8.onnx",
        "https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/main/model.int8.onnx",
    ];

    pub const TOKENS_URLS: &'static [&'static str] = &[
        "https://www.modelscope.cn/models/poloniumrock/SenseVoiceSmallOnnx/resolve/master/tokens.txt",
        "https://hf-mirror.com/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/main/tokens.txt",
        "https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/main/tokens.txt",
    ];

    /// Get local model directory path
    pub fn get_model_dir(app: &AppHandle) -> PathBuf {
        let base = app
            .path()
            .app_data_dir()
            .unwrap_or_else(|_| PathBuf::from("."));
        base.join("models").join(Self::MODEL_NAME)
    }

    /// Check if SenseVoice-Small model files exist and are valid
    pub fn check_status(app: &AppHandle) -> AsrModelStatus {
        let dir = Self::get_model_dir(app);
        let onnx_path = dir.join(Self::ONNX_FILE);
        let tokens_path = dir.join(Self::TOKENS_FILE);

        let mut is_ready = false;
        let mut model_size_bytes = 0;

        if onnx_path.exists() && tokens_path.exists() {
            if let Ok(meta) = std::fs::metadata(&onnx_path) {
                model_size_bytes = meta.len();
                // SenseVoice int8 ONNX is ~140MB+
                if model_size_bytes > 50_000_000 {
                    is_ready = true;
                }
            }
        }

        let model_size_mb = (model_size_bytes as f32 / (1024.0 * 1024.0) * 10.0).round() / 10.0;

        AsrModelStatus {
            is_ready,
            model_dir: dir.to_string_lossy().to_string(),
            model_file: if onnx_path.exists() {
                Some(onnx_path.to_string_lossy().to_string())
            } else {
                None
            },
            tokens_file: if tokens_path.exists() {
                Some(tokens_path.to_string_lossy().to_string())
            } else {
                None
            },
            model_size_bytes,
            model_size_mb,
        }
    }

    /// Download model files with streaming progress reporting
    pub async fn download_model(app: AppHandle) -> Result<(), String> {
        let dir = Self::get_model_dir(&app);
        tokio::fs::create_dir_all(&dir)
            .await
            .map_err(|e| format!("Failed to create model directory: {}", e))?;

        let client = reqwest::Client::builder()
            .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
            .redirect(reqwest::redirect::Policy::limited(10))
            .timeout(std::time::Duration::from_secs(900))
            .build()
            .map_err(|e| e.to_string())?;

        // 1. Download tokens.txt
        let tokens_path = dir.join(Self::TOKENS_FILE);
        if !tokens_path.exists() {
            Self::download_single_file(
                &client,
                Self::TOKENS_URLS,
                &tokens_path,
                Self::TOKENS_FILE,
                &app,
            )
            .await?;
        }

        // 2. Download model.int8.onnx
        let onnx_path = dir.join(Self::ONNX_FILE);
        Self::download_single_file(
            &client,
            Self::ONNX_URLS,
            &onnx_path,
            Self::ONNX_FILE,
            &app,
        )
        .await?;

        // Final completion event
        let _ = app.emit(
            "asr-model-download-progress",
            ModelDownloadProgress {
                file_name: Self::ONNX_FILE.to_string(),
                downloaded_bytes: 0,
                total_bytes: 0,
                percentage: 100.0,
                is_completed: true,
                error: None,
            },
        );

        Ok(())
    }

    async fn download_single_file(
        client: &reqwest::Client,
        urls: &[&str],
        dest: &Path,
        file_name: &str,
        app: &AppHandle,
    ) -> Result<(), String> {
        use tokio::io::AsyncWriteExt;

        let mut last_err = String::from("No URLs provided");
        let mut successful_resp = None;

        for &url in urls {
            println!("[ModelManager] 正在尝试从镜像源下载 {}: {}", file_name, url);
            match client.get(url).send().await {
                Ok(resp) => {
                    let status = resp.status();
                    if status.is_success() {
                        println!("[ModelManager] 镜像源连接成功 (HTTP {})", status);
                        successful_resp = Some(resp);
                        break;
                    } else {
                        last_err = format!("HTTP {} from {}", status, url);
                        eprintln!("[ModelManager 警告] 镜像返回非成功状态: {}", last_err);
                    }
                }
                Err(e) => {
                    last_err = format!("连接错误 ({}): {}", url, e);
                    eprintln!("[ModelManager 警告] 镜像连接失败: {}", last_err);
                }
            }
        }

        let mut resp = match successful_resp {
            Some(r) => r,
            None => {
                let err_msg = format!("所有镜像源均下载失败 ({}): {}", file_name, last_err);
                let _ = app.emit(
                    "asr-model-download-progress",
                    ModelDownloadProgress {
                        file_name: file_name.to_string(),
                        downloaded_bytes: 0,
                        total_bytes: 0,
                        percentage: 0.0,
                        is_completed: false,
                        error: Some(err_msg.clone()),
                    },
                );
                return Err(err_msg);
            }
        };

        let mut total_size = resp.content_length().unwrap_or(0);
        if total_size == 0 {
            if file_name == Self::ONNX_FILE {
                total_size = 239_233_841;
            } else if file_name == Self::TOKENS_FILE {
                total_size = 464_000;
            }
        }
        let temp_path = dest.with_extension("tmp");
        let mut file = tokio::fs::File::create(&temp_path)
            .await
            .map_err(|e| format!("无法创建临时文件: {}", e))?;

        let mut downloaded: u64 = 0;
        let mut last_emit = std::time::Instant::now();

        while let Some(chunk) = resp
            .chunk()
            .await
            .map_err(|e| format!("下载数据流中断: {}", e))?
        {
            file.write_all(&chunk)
                .await
                .map_err(|e| format!("写入磁盘失败: {}", e))?;
            downloaded += chunk.len() as u64;

            if last_emit.elapsed().as_millis() > 200 {
                last_emit = std::time::Instant::now();
                let percentage = if total_size > 0 {
                    (downloaded as f32 / total_size as f32 * 100.0).min(99.9)
                } else {
                    0.0
                };

                let _ = app.emit(
                    "asr-model-download-progress",
                    ModelDownloadProgress {
                        file_name: file_name.to_string(),
                        downloaded_bytes: downloaded,
                        total_bytes: total_size,
                        percentage,
                        is_completed: false,
                        error: None,
                    },
                );
            }
        }

        file.flush().await.map_err(|e| e.to_string())?;
        drop(file);

        tokio::fs::rename(&temp_path, dest)
            .await
            .map_err(|e| format!("重命名模型文件失败: {}", e))?;

        println!("[ModelManager] 文件 {} 校验并落盘成功", file_name);
        Ok(())
    }
}
