use crate::models::SpeakerRole;

/// Represents a segmented chunk of speech ready for ASR transcription
#[derive(Debug, Clone)]
pub struct AudioChunk {
    pub speaker: SpeakerRole,
    pub start_timestamp_ms: u64,
    pub end_timestamp_ms: u64,
    pub samples: Vec<f32>,
}

/// Real-time energy-based Voice Activity Detection and chunking buffer.
/// Splits continuous 16kHz mono audio into distinct utterance chunks.
pub struct AudioChunker {
    pub speaker: SpeakerRole,
    sample_rate: u32,
    base_threshold: f32,
    silence_threshold_samples: usize,
    max_chunk_samples: usize,
    min_chunk_samples: usize,

    // Internal state
    is_in_speech: bool,
    speech_start_ms: u64,
    silence_samples_count: usize,
    speech_buffer: Vec<f32>,
    pre_roll_buffer: Vec<f32>,
    max_pre_roll_samples: usize,

    // Anti-noise & transient spike rejection
    noise_floor: f32,
    voice_frames_count: usize,
    min_voice_onset_frames: usize,
}

impl AudioChunker {
    pub fn new(speaker: SpeakerRole) -> Self {
        let sample_rate = 16_000;
        // 500ms of silence to mark the end of an utterance
        let silence_threshold_samples = (sample_rate as f32 * 0.50) as usize;
        // Max 10 seconds per chunk to prevent delayed transcription
        let max_chunk_samples = (sample_rate as f32 * 10.0) as usize;
        // Min 450ms to filter out ambient clicks/coughs/rustles
        let min_chunk_samples = (sample_rate as f32 * 0.45) as usize;
        // 250ms pre-roll to capture the onset of speech
        let max_pre_roll_samples = (sample_rate as f32 * 0.25) as usize;

        // Balanced base threshold: 0.0055 for mic (blocks fans/room hum), 0.0040 for speaker
        let base_threshold = match speaker {
            SpeakerRole::Me => 0.0055,
            SpeakerRole::Remote => 0.0040,
        };

        Self {
            speaker,
            sample_rate,
            base_threshold,
            silence_threshold_samples,
            max_chunk_samples,
            min_chunk_samples,

            is_in_speech: false,
            speech_start_ms: 0,
            silence_samples_count: 0,
            speech_buffer: Vec::with_capacity(sample_rate as usize * 4),
            pre_roll_buffer: Vec::with_capacity(max_pre_roll_samples),
            max_pre_roll_samples,

            noise_floor: 0.0015,
            voice_frames_count: 0,
            min_voice_onset_frames: 2, // Require ~80ms sustained voice, rejecting single-frame clicks
        }
    }

    /// Process incoming 16kHz mono audio samples with noise-gate & transient rejection.
    /// If an utterance ends or reaches max duration, returns an `AudioChunk`.
    pub fn push_samples(&mut self, samples: &[f32], current_time_ms: u64) -> Option<AudioChunk> {
        if samples.is_empty() {
            return None;
        }

        // Compute RMS energy of the incoming block
        let mut sum_sq = 0.0f32;
        for &s in samples {
            sum_sq += s * s;
        }
        let rms = (sum_sq / samples.len() as f32).sqrt();

        // Adaptive threshold: must exceed 2.2x the current ambient noise floor
        let dynamic_threshold = (self.noise_floor * 2.2).max(self.base_threshold);
        let is_voice = rms >= dynamic_threshold;

        if is_voice {
            self.silence_samples_count = 0;
            self.voice_frames_count += 1;

            if !self.is_in_speech {
                // Only enter speech if sustained for at least min_voice_onset_frames
                if self.voice_frames_count >= self.min_voice_onset_frames {
                    self.is_in_speech = true;
                    let pre_roll_ms = (self.pre_roll_buffer.len() as f64 / self.sample_rate as f64 * 1000.0) as u64;
                    self.speech_start_ms = current_time_ms.saturating_sub(pre_roll_ms);

                    self.speech_buffer.clear();
                    self.speech_buffer.extend_from_slice(&self.pre_roll_buffer);
                    self.speech_buffer.extend_from_slice(samples);
                } else {
                    // Still confirming onset: buffer into pre-roll
                    self.pre_roll_buffer.extend_from_slice(samples);
                    if self.pre_roll_buffer.len() > self.max_pre_roll_samples {
                        let drain_count = self.pre_roll_buffer.len() - self.max_pre_roll_samples;
                        self.pre_roll_buffer.drain(0..drain_count);
                    }
                }
            } else {
                self.speech_buffer.extend_from_slice(samples);

                // Max chunk protection: if user speaks continuously for 10s without pause
                if self.speech_buffer.len() >= self.max_chunk_samples {
                    let chunk_samples = std::mem::take(&mut self.speech_buffer);
                    let chunk = AudioChunk {
                        speaker: self.speaker.clone(),
                        start_timestamp_ms: self.speech_start_ms,
                        end_timestamp_ms: current_time_ms,
                        samples: chunk_samples,
                    };
                    self.speech_start_ms = current_time_ms;
                    return Some(chunk);
                }
            }
        } else {
            self.voice_frames_count = 0;

            if self.is_in_speech {
                self.silence_samples_count += samples.len();
                self.speech_buffer.extend_from_slice(samples);

                // Utterance ended by silence threshold (500ms)
                if self.silence_samples_count >= self.silence_threshold_samples {
                    self.is_in_speech = false;
                    self.silence_samples_count = 0;

                    if self.speech_buffer.len() >= self.min_chunk_samples {
                        // Trim trailing silence samples from the chunk
                        let trailing = self.silence_threshold_samples.min(self.speech_buffer.len());
                        let valid_len = self.speech_buffer.len() - trailing;
                        self.speech_buffer.truncate(valid_len);

                        let chunk_samples = std::mem::take(&mut self.speech_buffer);
                        let chunk = AudioChunk {
                            speaker: self.speaker.clone(),
                            start_timestamp_ms: self.speech_start_ms,
                            end_timestamp_ms: current_time_ms,
                            samples: chunk_samples,
                        };
                        return Some(chunk);
                    } else {
                        self.speech_buffer.clear();
                    }
                }
            } else {
                // Track baseline noise floor using moving average during quiet periods
                self.noise_floor = self.noise_floor * 0.98 + rms * 0.02;

                // Maintain rolling pre-roll buffer
                self.pre_roll_buffer.extend_from_slice(samples);
                if self.pre_roll_buffer.len() > self.max_pre_roll_samples {
                    let drain_count = self.pre_roll_buffer.len() - self.max_pre_roll_samples;
                    self.pre_roll_buffer.drain(0..drain_count);
                }
            }
        }

        None
    }

    /// Flush any pending speech buffer on recording stop
    pub fn flush(&mut self, current_time_ms: u64) -> Option<AudioChunk> {
        if self.is_in_speech && self.speech_buffer.len() >= self.min_chunk_samples {
            self.is_in_speech = false;
            let chunk_samples = std::mem::take(&mut self.speech_buffer);
            Some(AudioChunk {
                speaker: self.speaker.clone(),
                start_timestamp_ms: self.speech_start_ms,
                end_timestamp_ms: current_time_ms,
                samples: chunk_samples,
            })
        } else {
            self.is_in_speech = false;
            self.speech_buffer.clear();
            None
        }
    }
}
