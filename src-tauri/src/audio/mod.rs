pub mod resampler;
pub mod wav_writer;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use tauri::{AppHandle, Emitter};

use crate::asr::{AudioChunk, AudioChunker};
use crate::models::{AudioDeviceInfo, SpeakerRole};
use resampler::AudioResampler;
use wav_writer::AudioFileWriter;

#[cfg(target_os = "macos")]
type MacAudioCallback = extern "C" fn(*const f32, i32, i32, f64);

#[cfg(target_os = "macos")]
extern "C" {
    fn mac_start_loopback_capture(on_audio_data: Option<MacAudioCallback>) -> i32;
    fn mac_stop_loopback_capture();
    fn mac_check_screen_capture_permission() -> bool;
    fn mac_request_screen_capture_permission() -> bool;
}

#[cfg(target_os = "macos")]
struct MacAudioSink {
    resampler: Option<AudioResampler>,
    writer: Arc<Mutex<AudioFileWriter>>,
    level_bits: Arc<AtomicU32>,
    chunker: Arc<Mutex<AudioChunker>>,
    chunk_tx: tokio::sync::mpsc::Sender<AudioChunk>,
    start_time: std::time::Instant,
}

#[cfg(target_os = "macos")]
static MAC_AUDIO_SINK: Mutex<Option<MacAudioSink>> = Mutex::new(None);

#[cfg(target_os = "macos")]
extern "C" fn on_mac_audio_data(
    samples_ptr: *const f32,
    sample_count: i32,
    channels: i32,
    sample_rate: f64,
) {
    if samples_ptr.is_null() || sample_count <= 0 || channels <= 0 {
        return;
    }

    let samples = unsafe { std::slice::from_raw_parts(samples_ptr, sample_count as usize) };

    if let Ok(mut sink_guard) = MAC_AUDIO_SINK.lock() {
        if let Some(sink) = sink_guard.as_mut() {
            let sr = sample_rate as u32;
            let ch = channels as usize;

            let need_new = match &sink.resampler {
                Some(r) => r.input_sample_rate != sr || r.channels != ch,
                None => true,
            };
            if need_new {
                sink.resampler = Some(AudioResampler::new(sr, ch));
            }

            if let Some(resampler) = &mut sink.resampler {
                let (f32_mono, i16_samples, level) = resampler.process(samples);
                sink.level_bits.store(level.to_bits(), Ordering::Relaxed);

                if let Ok(mut w) = sink.writer.lock() {
                    let _ = w.write_samples(&i16_samples);
                }

                let elapsed_ms = sink.start_time.elapsed().as_millis() as u64;
                if let Ok(mut chunker) = sink.chunker.lock() {
                    if let Some(chunk) = chunker.push_samples(&f32_mono, elapsed_ms) {
                        let _ = sink.chunk_tx.try_send(chunk);
                    }
                }
            }
        }
    }
}

enum AudioThreadMsg {
    Start {
        meeting_id: String,
        base_dir: PathBuf,
        chunk_tx: tokio::sync::mpsc::Sender<AudioChunk>,
        reply: mpsc::Sender<Result<(), String>>,
    },
    Stop {
        reply: mpsc::Sender<Result<(Option<String>, Option<String>), String>>,
    },
    #[allow(dead_code)]
    SetDevices {
        mic: Option<String>,
        speaker: Option<String>,
    },
}

pub struct AudioEngine {
    tx: mpsc::Sender<AudioThreadMsg>,
    is_running: Arc<AtomicBool>,
    mic_level_bits: Arc<AtomicU32>,
    speaker_level_bits: Arc<AtomicU32>,
    start_time: Arc<Mutex<Option<std::time::Instant>>>,
}

impl AudioEngine {
    pub fn new() -> Self {
        let (tx, rx) = mpsc::channel::<AudioThreadMsg>();
        let is_running = Arc::new(AtomicBool::new(false));
        let mic_level_bits = Arc::new(AtomicU32::new(0.0f32.to_bits()));
        let speaker_level_bits = Arc::new(AtomicU32::new(0.0f32.to_bits()));
        let start_time = Arc::new(Mutex::new(None));

        let is_running_thread = is_running.clone();
        let mic_level_thread = mic_level_bits.clone();
        let speaker_level_thread = speaker_level_bits.clone();

        // Spawn dedicated OS thread for audio streams to avoid Send/Sync issues on macOS
        std::thread::Builder::new()
            .name("invimeet-audio-capture".to_string())
            .spawn(move || {
                let mut mic_stream: Option<cpal::Stream> = None;
                #[allow(unused_mut)]
                let mut speaker_stream: Option<cpal::Stream> = None;
                let mut mic_writer: Option<Arc<Mutex<AudioFileWriter>>> = None;
                #[allow(unused_mut)]
                let mut speaker_writer: Option<Arc<Mutex<AudioFileWriter>>> = None;
                let mut mic_file_path: Option<String> = None;
                let mut speaker_file_path: Option<String> = None;
                #[cfg(target_os = "macos")]
                let mut mac_loopback_active = false;

                let mut active_mic_chunker: Option<Arc<Mutex<AudioChunker>>> = None;
                let mut active_spk_chunker: Option<Arc<Mutex<AudioChunker>>> = None;
                let mut active_chunk_tx: Option<tokio::sync::mpsc::Sender<AudioChunk>> = None;
                let mut session_start: Option<std::time::Instant> = None;

                while let Ok(msg) = rx.recv() {
                    match msg {
                        AudioThreadMsg::Start {
                            meeting_id,
                            base_dir,
                            chunk_tx,
                            reply,
                        } => {
                            let start_inst = std::time::Instant::now();
                            session_start = Some(start_inst);
                            active_chunk_tx = Some(chunk_tx.clone());

                            let mic_chunker = Arc::new(Mutex::new(AudioChunker::new(SpeakerRole::Me)));
                            active_mic_chunker = Some(mic_chunker.clone());

                            let spk_chunker = Arc::new(Mutex::new(AudioChunker::new(SpeakerRole::Remote)));
                            active_spk_chunker = Some(spk_chunker.clone());

                            let meeting_dir = base_dir.join("meetings").join(&meeting_id);
                            let mic_path = meeting_dir.join("mic.wav");
                            let speaker_path = meeting_dir.join("speaker.wav");

                            let writer_mic = match AudioFileWriter::create(&mic_path) {
                                Ok(w) => Arc::new(Mutex::new(w)),
                                Err(e) => {
                                    let _ = reply.send(Err(e));
                                    continue;
                                }
                            };

                            let host = cpal::default_host();

                            // 1. Microphone Input Stream (Common for macOS / Windows / Linux)
                            if let Some(mic_device) = host.default_input_device() {
                                if let Ok(mic_config) = mic_device.default_input_config() {
                                    let sample_rate = mic_config.sample_rate().0;
                                    let channels = mic_config.channels() as usize;
                                    let mut resampler = AudioResampler::new(sample_rate, channels);
                                    let writer_clone = writer_mic.clone();
                                    let level_clone = mic_level_thread.clone();
                                    let mic_chunker_clone = mic_chunker.clone();
                                    let mic_tx_clone = chunk_tx.clone();

                                    let stream_res = match mic_config.sample_format() {
                                        cpal::SampleFormat::F32 => mic_device.build_input_stream(
                                            &mic_config.into(),
                                            move |data: &[f32], _| {
                                                let (f32_data, i16_data, level) =
                                                    resampler.process(data);
                                                level_clone
                                                    .store(level.to_bits(), Ordering::Relaxed);
                                                if let Ok(mut w) = writer_clone.lock() {
                                                    let _ = w.write_samples(&i16_data);
                                                }
                                                let elapsed_ms = start_inst.elapsed().as_millis() as u64;
                                                if let Ok(mut chunker) = mic_chunker_clone.lock() {
                                                    if let Some(chunk) = chunker.push_samples(&f32_data, elapsed_ms) {
                                                        let _ = mic_tx_clone.try_send(chunk);
                                                    }
                                                }
                                            },
                                            |err| eprintln!("Mic audio error: {}", err),
                                            None,
                                        ),
                                        cpal::SampleFormat::I16 => mic_device.build_input_stream(
                                            &mic_config.into(),
                                            move |data: &[i16], _| {
                                                let f32_samples: Vec<f32> = data
                                                    .iter()
                                                    .map(|&s| s as f32 / 32768.0)
                                                    .collect();
                                                let (f32_data, i16_data, level) =
                                                    resampler.process(&f32_samples);
                                                level_clone
                                                    .store(level.to_bits(), Ordering::Relaxed);
                                                if let Ok(mut w) = writer_clone.lock() {
                                                    let _ = w.write_samples(&i16_data);
                                                }
                                                let elapsed_ms = start_inst.elapsed().as_millis() as u64;
                                                if let Ok(mut chunker) = mic_chunker_clone.lock() {
                                                    if let Some(chunk) = chunker.push_samples(&f32_data, elapsed_ms) {
                                                        let _ = mic_tx_clone.try_send(chunk);
                                                    }
                                                }
                                            },
                                            |err| eprintln!("Mic audio error: {}", err),
                                            None,
                                        ),
                                        _ => Err(cpal::BuildStreamError::DeviceNotAvailable),
                                    };

                                    if let Ok(stream) = stream_res {
                                        if stream.play().is_ok() {
                                            mic_stream = Some(stream);
                                        }
                                    }
                                }
                            }

                            // 2. Speaker Loopback Stream
                            // Platform A: macOS Native ScreenCaptureKit Loopback
                            #[cfg(target_os = "macos")]
                            {
                                let mut sck_success = false;

                                let writer_spk = match AudioFileWriter::create(&speaker_path) {
                                    Ok(w) => Arc::new(Mutex::new(w)),
                                    Err(e) => {
                                        eprintln!("[InviMeet Audio] Failed to create speaker.wav: {}", e);
                                        let _ = reply.send(Err(e));
                                        continue;
                                    }
                                };

                                if let Ok(mut sink_guard) = MAC_AUDIO_SINK.lock() {
                                    *sink_guard = Some(MacAudioSink {
                                        resampler: None,
                                        writer: writer_spk.clone(),
                                        level_bits: speaker_level_thread.clone(),
                                        chunker: spk_chunker.clone(),
                                        chunk_tx: chunk_tx.clone(),
                                        start_time: start_inst,
                                    });
                                }

                                let res = unsafe { mac_start_loopback_capture(Some(on_mac_audio_data)) };
                                if res == 0 {
                                    sck_success = true;
                                    mac_loopback_active = true;
                                    speaker_writer = Some(writer_spk);
                                    speaker_file_path =
                                        Some(speaker_path.to_string_lossy().to_string());
                                    println!("[InviMeet Audio] macOS ScreenCaptureKit 扬声器环回采集已成功启动");
                                } else {
                                    eprintln!("[InviMeet Audio 警告] ScreenCaptureKit 启动返回错误码: {}，尝试降级检测虚拟声卡", res);
                                    if let Ok(mut sink_guard) = MAC_AUDIO_SINK.lock() {
                                        *sink_guard = None;
                                    }
                                }

                                // Fallback for macOS: If ScreenCaptureKit failed, check for virtual audio devices (BlackHole, Soundflower)
                                if !sck_success {
                                    let mut found_virtual = false;
                                    if let Ok(input_devs) = host.input_devices() {
                                        for dev in input_devs {
                                            if let Ok(name) = dev.name() {
                                                let lower = name.to_lowercase();
                                                if lower.contains("blackhole")
                                                    || lower.contains("soundflower")
                                                    || lower.contains("loopback")
                                                    || lower.contains("vb-cable")
                                                {
                                                    if let Ok(cfg) = dev.default_input_config() {
                                                        let sample_rate = cfg.sample_rate().0;
                                                        let channels = cfg.channels() as usize;
                                                        let mut resampler =
                                                            AudioResampler::new(sample_rate, channels);
                                                        let writer_spk = match AudioFileWriter::create(&speaker_path) {
                                                            Ok(w) => Arc::new(Mutex::new(w)),
                                                            Err(_) => continue,
                                                        };
                                                        let writer_clone = writer_spk.clone();
                                                        let level_clone = speaker_level_thread.clone();

                                                        let stream_res = dev.build_input_stream(
                                                            &cfg.into(),
                                                            move |data: &[f32], _| {
                                                                let (_f32_data, i16_data, level) =
                                                                    resampler.process(data);
                                                                level_clone.store(
                                                                    level.to_bits(),
                                                                    Ordering::Relaxed,
                                                                );
                                                                if let Ok(mut w) = writer_clone.lock() {
                                                                    let _ = w.write_samples(&i16_data);
                                                                }
                                                            },
                                                            |err| eprintln!("Virtual speaker loopback error: {}", err),
                                                            None,
                                                        );

                                                        if let Ok(stream) = stream_res {
                                                            if stream.play().is_ok() {
                                                                speaker_stream = Some(stream);
                                                                speaker_writer = Some(writer_spk);
                                                                speaker_file_path = Some(
                                                                    speaker_path.to_string_lossy().to_string(),
                                                                );
                                                                found_virtual = true;
                                                                println!("[InviMeet Audio] 成功接入虚拟声卡环回: {}", name);
                                                                break;
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }

                                    if !found_virtual {
                                        // Create a valid empty WAV file as safe fallback to prevent downstream errors
                                        if let Ok(dummy) = AudioFileWriter::create(&speaker_path) {
                                            let _ = dummy.finalize();
                                            speaker_file_path =
                                                Some(speaker_path.to_string_lossy().to_string());
                                        }
                                        eprintln!("[InviMeet Audio 提示] 未捕获扬声器声音。请在 macOS「系统设置 - 隐私与安全性 - 屏幕与系统音频录制」中为 InviMeet 开启权限。");
                                    }
                                }
                            }

                            // Platform B: Windows Native WASAPI Loopback Capture
                            #[cfg(target_os = "windows")]
                            {
                                if let Some(speaker_device) = host.default_output_device() {
                                    // CRITICAL FOR WASAPI LOOPBACK: Must use default_output_config() to build input stream!
                                    if let Ok(spk_config) = speaker_device.default_output_config() {
                                        let sample_rate = spk_config.sample_rate().0;
                                        let channels = spk_config.channels() as usize;
                                        let mut resampler = AudioResampler::new(sample_rate, channels);
                                        let writer_spk = match AudioFileWriter::create(&speaker_path) {
                                            Ok(w) => Arc::new(Mutex::new(w)),
                                            Err(e) => {
                                                eprintln!("Failed to create speaker wav file: {}", e);
                                                continue;
                                            }
                                        };
                                        let writer_clone = writer_spk.clone();
                                        let level_clone = speaker_level_thread.clone();
                                        let spk_chunker_clone = spk_chunker.clone();
                                        let spk_tx_clone = chunk_tx.clone();

                                        let stream_res = speaker_device.build_input_stream(
                                            &spk_config.into(),
                                            move |data: &[f32], _| {
                                                let (f32_data, i16_data, level) =
                                                    resampler.process(data);
                                                level_clone.store(level.to_bits(), Ordering::Relaxed);
                                                if let Ok(mut w) = writer_clone.lock() {
                                                    let _ = w.write_samples(&i16_data);
                                                }
                                                let elapsed_ms = start_inst.elapsed().as_millis() as u64;
                                                if let Ok(mut chunker) = spk_chunker_clone.lock() {
                                                    if let Some(chunk) = chunker.push_samples(&f32_data, elapsed_ms) {
                                                        let _ = spk_tx_clone.try_send(chunk);
                                                    }
                                                }
                                            },
                                            |err| eprintln!("Windows WASAPI Loopback error: {}", err),
                                            None,
                                        );

                                        if let Ok(stream) = stream_res {
                                            if stream.play().is_ok() {
                                                speaker_stream = Some(stream);
                                                speaker_writer = Some(writer_spk);
                                                speaker_file_path =
                                                    Some(speaker_path.to_string_lossy().to_string());
                                                println!("[InviMeet Audio] Windows WASAPI 原生扬声器环回采集已成功启动");
                                            }
                                        }
                                    }
                                }
                            }

                            // Platform C: Linux PulseAudio/PipeWire monitor or fallback
                            #[cfg(not(any(target_os = "macos", target_os = "windows")))]
                            {
                                if let Some(speaker_device) = host.default_output_device() {
                                    if let Ok(spk_config) = speaker_device.default_output_config() {
                                        let sample_rate = spk_config.sample_rate().0;
                                        let channels = spk_config.channels() as usize;
                                        let mut resampler = AudioResampler::new(sample_rate, channels);
                                        let writer_spk = match AudioFileWriter::create(&speaker_path) {
                                            Ok(w) => Arc::new(Mutex::new(w)),
                                            Err(e) => {
                                                eprintln!("Failed to create speaker wav file: {}", e);
                                                continue;
                                            }
                                        };
                                        let writer_clone = writer_spk.clone();
                                        let level_clone = speaker_level_thread.clone();

                                        let stream_res = speaker_device.build_input_stream(
                                            &spk_config.into(),
                                            move |data: &[f32], _| {
                                                let (_f32_data, i16_data, level) =
                                                    resampler.process(data);
                                                level_clone.store(level.to_bits(), Ordering::Relaxed);
                                                if let Ok(mut w) = writer_clone.lock() {
                                                    let _ = w.write_samples(&i16_data);
                                                }
                                            },
                                            |err| eprintln!("Linux Loopback error: {}", err),
                                            None,
                                        );

                                        if let Ok(stream) = stream_res {
                                            if stream.play().is_ok() {
                                                speaker_stream = Some(stream);
                                                speaker_writer = Some(writer_spk);
                                                speaker_file_path =
                                                    Some(speaker_path.to_string_lossy().to_string());
                                            }
                                        }
                                    }
                                }
                            }

                            mic_writer = Some(writer_mic);
                            mic_file_path = Some(mic_path.to_string_lossy().to_string());
                            is_running_thread.store(true, Ordering::SeqCst);

                            let _ = reply.send(Ok(()));
                        }
                        AudioThreadMsg::Stop { reply } => {
                            is_running_thread.store(false, Ordering::SeqCst);

                            if let Some(start_inst) = session_start.take() {
                                let elapsed_ms = start_inst.elapsed().as_millis() as u64;
                                if let Some(tx) = active_chunk_tx.take() {
                                    if let Some(c) = active_mic_chunker.take() {
                                        if let Ok(mut chunker) = c.lock() {
                                            if let Some(chunk) = chunker.flush(elapsed_ms) {
                                                let _ = tx.try_send(chunk);
                                            }
                                        }
                                    }
                                    if let Some(c) = active_spk_chunker.take() {
                                        if let Ok(mut chunker) = c.lock() {
                                            if let Some(chunk) = chunker.flush(elapsed_ms) {
                                                let _ = tx.try_send(chunk);
                                            }
                                        }
                                    }
                                }
                            }

                            if let Some(stream) = mic_stream.take() {
                                let _ = stream.pause();
                            }
                            if let Some(stream) = speaker_stream.take() {
                                let _ = stream.pause();
                            }

                            #[cfg(target_os = "macos")]
                            if mac_loopback_active {
                                unsafe { mac_stop_loopback_capture() };
                                if let Ok(mut sink_guard) = MAC_AUDIO_SINK.lock() {
                                    *sink_guard = None;
                                }
                                mac_loopback_active = false;
                            }

                            mic_level_thread.store(0.0f32.to_bits(), Ordering::SeqCst);
                            speaker_level_thread.store(0.0f32.to_bits(), Ordering::SeqCst);

                            let mut final_mic = None;
                            if let Some(w) = mic_writer.take() {
                                if let Ok(mut guard) = w.lock() {
                                    let temp_writer = std::mem::replace(
                                        &mut *guard,
                                        AudioFileWriter::create(PathBuf::from("/dev/null"))
                                            .unwrap_or_else(|_| panic!("dummy writer")),
                                    );
                                    let _ = temp_writer.finalize();
                                    final_mic = mic_file_path.take();
                                }
                            }

                            let mut final_spk = None;
                            if let Some(w) = speaker_writer.take() {
                                if let Ok(mut guard) = w.lock() {
                                    let temp_writer = std::mem::replace(
                                        &mut *guard,
                                        AudioFileWriter::create(PathBuf::from("/dev/null"))
                                            .unwrap_or_else(|_| panic!("dummy writer")),
                                    );
                                    let _ = temp_writer.finalize();
                                    final_spk = speaker_file_path.take();
                                }
                            } else {
                                final_spk = speaker_file_path.take();
                            }

                            let _ = reply.send(Ok((final_mic, final_spk)));
                        }
                        AudioThreadMsg::SetDevices { mic: _, speaker: _ } => {
                            // Can be used for dynamic hot-reconnecting
                        }
                    }
                }
            })
            .expect("Failed to spawn audio capture thread");

        Self {
            tx,
            is_running,
            mic_level_bits,
            speaker_level_bits,
            start_time,
        }
    }

    /// Check if system screen/audio capture permission is granted
    pub fn check_screen_capture_permission() -> bool {
        #[cfg(target_os = "macos")]
        unsafe {
            mac_check_screen_capture_permission()
        }
        #[cfg(not(target_os = "macos"))]
        true
    }

    /// Request screen/audio capture permission
    pub fn request_screen_capture_permission() -> bool {
        #[cfg(target_os = "macos")]
        unsafe {
            mac_request_screen_capture_permission()
        }
        #[cfg(not(target_os = "macos"))]
        true
    }

    /// Enumerate all available audio input (mic) and output (speaker) devices
    pub fn list_devices(&self) -> Vec<AudioDeviceInfo> {
        let host = cpal::default_host();
        let mut devices = Vec::new();

        if let Ok(input_devs) = host.input_devices() {
            for dev in input_devs {
                if let Ok(name) = dev.name() {
                    devices.push(AudioDeviceInfo {
                        id: name.clone(),
                        name,
                        is_default: false,
                        kind: "input".to_string(),
                    });
                }
            }
        }

        if let Ok(output_devs) = host.output_devices() {
            for dev in output_devs {
                if let Ok(name) = dev.name() {
                    devices.push(AudioDeviceInfo {
                        id: name.clone(),
                        name,
                        is_default: false,
                        kind: "output".to_string(),
                    });
                }
            }
        }

        if devices.is_empty() {
            devices.push(AudioDeviceInfo {
                id: "default_mic".to_string(),
                name: "默认系统麦克风".to_string(),
                is_default: true,
                kind: "input".to_string(),
            });
            devices.push(AudioDeviceInfo {
                id: "default_speaker".to_string(),
                name: "默认系统扬声器 (环回)".to_string(),
                is_default: true,
                kind: "output".to_string(),
            });
        }

        devices
    }

    /// Start capturing dual audio streams and start periodic volume level emitter
    pub async fn start_capture(
        &self,
        meeting_id: String,
        base_dir: PathBuf,
        chunk_tx: tokio::sync::mpsc::Sender<AudioChunk>,
        app_handle: AppHandle,
    ) -> Result<(), String> {
        let (reply_tx, reply_rx) = mpsc::channel();

        self.tx
            .send(AudioThreadMsg::Start {
                meeting_id,
                base_dir,
                chunk_tx,
                reply: reply_tx,
            })
            .map_err(|e| format!("Failed to send start command to audio thread: {}", e))?;

        let res = reply_rx
            .recv()
            .map_err(|e| format!("Audio thread reply error: {}", e))??;

        if let Ok(mut st) = self.start_time.lock() {
            *st = Some(std::time::Instant::now());
        }

        // Background Level Emitter: 20Hz (every 50ms) push to frontend
        let is_running_emitter = self.is_running.clone();
        let mic_level_for_emitter = self.mic_level_bits.clone();
        let spk_level_for_emitter = self.speaker_level_bits.clone();
        let start_time_for_emitter = self.start_time.clone();

        tokio::spawn(async move {
            let mut interval = tokio::time::interval(tokio::time::Duration::from_millis(50));
            while is_running_emitter.load(Ordering::Relaxed) {
                interval.tick().await;
                let mic_level = f32::from_bits(mic_level_for_emitter.load(Ordering::Relaxed));

                let speaker_level =
                    f32::from_bits(spk_level_for_emitter.load(Ordering::Relaxed));

                let duration = start_time_for_emitter
                    .lock()
                    .ok()
                    .and_then(|t| t.map(|inst| inst.elapsed().as_secs()))
                    .unwrap_or(0);

                let _ = app_handle.emit(
                    "audio-level",
                    serde_json::json!({
                        "micLevel": mic_level,
                        "speakerLevel": speaker_level,
                        "durationSeconds": duration
                    }),
                );
            }
            // Emit zero when stopped
            let _ = app_handle.emit(
                "audio-level",
                serde_json::json!({ "micLevel": 0.0, "speakerLevel": 0.0, "durationSeconds": 0 }),
            );
        });

        Ok(res)
    }

    /// Stop capturing audio streams and finalize audio WAV files
    pub async fn stop_capture(&self) -> Result<(Option<String>, Option<String>, u64), String> {
        let duration = self
            .start_time
            .lock()
            .ok()
            .and_then(|mut t| t.take().map(|inst| inst.elapsed().as_secs()))
            .unwrap_or(0);

        let (reply_tx, reply_rx) = mpsc::channel();

        self.tx
            .send(AudioThreadMsg::Stop { reply: reply_tx })
            .map_err(|e| format!("Failed to send stop command to audio thread: {}", e))?;

        let (mic, spk) = reply_rx
            .recv()
            .map_err(|e| format!("Audio thread reply error: {}", e))??;

        Ok((mic, spk, duration))
    }

    pub fn get_duration_seconds(&self) -> u64 {
        self.start_time
            .lock()
            .ok()
            .and_then(|t| t.map(|inst| inst.elapsed().as_secs()))
            .unwrap_or(0)
    }

    pub fn is_capturing(&self) -> bool {
        self.is_running.load(Ordering::SeqCst)
    }

    pub async fn set_devices(&self, mic: Option<String>, speaker: Option<String>) {
        let _ = self.tx.send(AudioThreadMsg::SetDevices { mic, speaker });
    }
}
