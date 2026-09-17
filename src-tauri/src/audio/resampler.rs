/// Audio resampler that downmixes multi-channel audio to mono
/// and linearly resamples from any input sample rate to target 16,000 Hz.
pub struct AudioResampler {
    pub input_sample_rate: u32,
    pub channels: usize,
    pub target_sample_rate: u32,
    phase: f64,
    prev_sample: f32,
}

impl AudioResampler {
    pub fn new(input_sample_rate: u32, channels: usize) -> Self {
        Self {
            input_sample_rate,
            channels,
            target_sample_rate: 16_000,
            phase: 0.0,
            prev_sample: 0.0,
        }
    }

    /// Process interleaved raw f32 samples from cpal,
    /// downmix to mono, and resample to 16kHz f32 & i16 samples.
    /// Also returns calculated RMS volume (0.0 - 1.0).
    pub fn process(&mut self, input: &[f32]) -> (Vec<f32>, Vec<i16>, f32) {
        if input.is_empty() || self.channels == 0 {
            return (Vec::new(), Vec::new(), 0.0);
        }

        // 1. Downmix interleaved channels to mono
        let num_frames = input.len() / self.channels;
        let mut mono = Vec::with_capacity(num_frames);
        let mut sum_squares = 0.0f32;

        for i in 0..num_frames {
            let mut sample_sum = 0.0f32;
            for c in 0..self.channels {
                sample_sum += input[i * self.channels + c];
            }
            let avg = sample_sum / self.channels as f32;
            mono.push(avg);
            sum_squares += avg * avg;
        }

        // 2. Calculate RMS Level (0.0 to 1.0) with non-linear speech sensitivity
        let rms = (sum_squares / num_frames.max(1) as f32).sqrt();
        let level = if rms > 0.0005 {
            // Human voice RMS is typically 0.005 - 0.15; sqrt expands low volume nicely
            (rms.sqrt() * 2.8).clamp(0.0, 1.0)
        } else {
            0.0
        };

        // 3. Fast path if already 16kHz
        if self.input_sample_rate == self.target_sample_rate {
            let i16_samples = mono
                .iter()
                .map(|&s| {
                    let clamped = s.clamp(-1.0, 1.0);
                    (clamped * 32767.0) as i16
                })
                .collect();
            return (mono, i16_samples, level);
        }

        // 4. Linear interpolation resampling
        let step = self.input_sample_rate as f64 / self.target_sample_rate as f64;
        let mut resampled_f32 = Vec::new();
        let mut resampled_i16 = Vec::new();

        let mut idx = self.phase;
        while idx < mono.len() as f64 {
            let i = idx.floor() as usize;
            let frac = (idx - idx.floor()) as f32;

            let s0 = if i == 0 {
                self.prev_sample
            } else {
                mono[i - 1]
            };
            let s1 = mono[i];

            let interpolated = s0 + frac * (s1 - s0);
            let clamped = interpolated.clamp(-1.0, 1.0);

            resampled_f32.push(clamped);
            resampled_i16.push((clamped * 32767.0) as i16);

            idx += step;
        }

        self.phase = idx - mono.len() as f64;
        if let Some(&last) = mono.last() {
            self.prev_sample = last;
        }

        (resampled_f32, resampled_i16, level)
    }
}
