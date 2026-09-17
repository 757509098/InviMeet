use std::fs::File;
use std::io::BufWriter;
use std::path::{Path, PathBuf};
use hound::{WavSpec, WavWriter};

pub struct AudioFileWriter {
    writer: Option<WavWriter<BufWriter<File>>>,
    file_path: PathBuf,
}

impl AudioFileWriter {
    pub fn create<P: AsRef<Path>>(path: P) -> Result<Self, String> {
        let path_buf = path.as_ref().to_path_buf();

        if let Some(parent) = path_buf.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("Failed to create dir: {}", e))?;
        }

        let spec = WavSpec {
            channels: 1,
            sample_rate: 16_000,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };

        let writer = WavWriter::create(&path_buf, spec)
            .map_err(|e| format!("Failed to create WAV file at {:?}: {}", path_buf, e))?;

        Ok(Self {
            writer: Some(writer),
            file_path: path_buf,
        })
    }

    pub fn write_samples(&mut self, samples: &[i16]) -> Result<(), String> {
        if let Some(ref mut w) = self.writer {
            for &sample in samples {
                w.write_sample(sample)
                    .map_err(|e| format!("Error writing sample: {}", e))?;
            }
        }
        Ok(())
    }

    pub fn finalize(mut self) -> Result<String, String> {
        if let Some(w) = self.writer.take() {
            w.finalize()
                .map_err(|e| format!("Error finalizing WAV file: {}", e))?;
        }
        Ok(self.file_path.to_string_lossy().to_string())
    }
}
