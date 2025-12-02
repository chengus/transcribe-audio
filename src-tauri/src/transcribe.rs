use std::fs::File;
use std::io::Write;
use std::path::{Path, PathBuf};

use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

fn format_timestamp(cs: i64) -> String {
    let total_ms = cs * 10; // centiseconds -> ms

    let hours = total_ms / 3_600_000;
    let rem_ms = total_ms % 3_600_000;

    let minutes = rem_ms / 60_000;
    let rem_ms = rem_ms % 60_000;

    let seconds = rem_ms / 1_000;
    let millis = rem_ms % 1_000;

    format!("{:02}:{:02}:{:02},{:03}", hours, minutes, seconds, millis)
}

fn derive_output_paths(wav_path: &str, write_srt: bool, write_txt: bool) -> (Option<PathBuf>, Option<PathBuf>) {
    /*
    @Param wav_path: path to the input WAV file
    @Param write_srt: whether to generate SRT file
    @Param write_txt: whether to generate TXT file
    @Returns: (Option<PathBuf> for SRT, Option<PathBuf> for TXT

    The output files are placed in the same directory as the input WAV
     */
    let p = Path::new(wav_path);
    let stem = p.file_stem().unwrap_or_default();

    let parent = p.parent().unwrap_or_else(|| Path::new("."));

    let srt = if write_srt {
        Some(parent.join(format!("{}.srt", stem.to_string_lossy())))
    } else {
        None
    };

    let txt = if write_txt {
        Some(parent.join(format!("{}.txt", stem.to_string_lossy())))
    } else {
        None
    };

    (srt, txt)
}

pub fn transcribe_file2(
    model_path: &str,
    wav_path: &str,
    output_format: &str,
    max_segment_length: u32,
    max_characters_per_segment: u32,
) -> Result<String, String> {
    println!("Received transcription request:");
    println!("  File path: {}", wav_path);
    println!("  Output format: {:?}", output_format);
    println!("  Model: {}", model_path);
    println!("  Max segment length (seconds): {}", max_segment_length);
    println!("  Max characters per segment: {}", max_characters_per_segment);

    Ok("Done!".to_string())
}

/// Pure Rust function you can call from a Tauri command.
///
/// `output_format`: "srt", "txt", or "both".
/// `max_segment_length`: maximum segment duration in seconds (0 = no limit).
/// `max_characters_per_segment`: max characters per segment (0 = no limit).
///
/// Returns the full plain-text transcript as a String (for UI),
/// and writes SRT/TXT files next to `wav_path` when requested.
pub fn transcribe_file(
    model_path: &str,
    wav_path: &str,
    output_format: &str,
    max_segment_length: u32,
    max_characters_per_segment: u32,
) -> Result<String, String> {
    let write_srt = matches!(output_format, "srt" | "both");
    let write_txt = matches!(output_format, "txt" | "both");

    if !write_srt && !write_txt {
        return Err(format!(
            "Invalid output format: {}. Use \"srt\", \"txt\", or \"both\".",
            output_format
        ));
    }

    // 1) Read WAV
    let samples: Vec<i16> = hound::WavReader::open(wav_path)
        .map_err(|e| format!("Failed to open wav: {e}"))?
        .into_samples::<i16>()
        .map(|x| x.map_err(|e| format!("Failed to read sample: {e}")))
        .collect::<Result<Vec<_>, _>>()?;

    // 2) Load model
    let ctx = WhisperContext::new_with_params(model_path, WhisperContextParameters::default())
        .map_err(|e| format!("Failed to load model: {e}"))?;
    let mut state = ctx
        .create_state()
        .map_err(|e| format!("Failed to create state: {e}"))?;

    // 3) Params
    let mut params = FullParams::new(SamplingStrategy::BeamSearch {
        beam_size: 5,
        patience: -1.0,
    });
    params.set_language(Some("en"));
    params.set_print_special(false);
    params.set_print_progress(true);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);

    // 4) Convert audio to f32 mono 16k (assuming input is already mono 16k PCM)
    let mut inter_samples = vec![0.0f32; samples.len()];
    whisper_rs::convert_integer_to_float_audio(&samples, &mut inter_samples)
        .map_err(|e| format!("Failed to convert audio: {e}"))?;

    // 5) Run model
    state
        .full(params, &inter_samples[..])
        .map_err(|e| format!("Failed to run model: {e}"))?;

    // 6) Collect raw segments from whisper
    #[derive(Debug, Clone)]
    struct RawSeg {
        start_cs: i64,
        end_cs: i64,
        text: String,
    }

    let mut raw_segments: Vec<RawSeg> = Vec::new();
    for segment in state.as_iter() {
        let text = segment.to_string();
        let trimmed = text.trim();
        if trimmed.is_empty() {
            continue;
        }
        raw_segments.push(RawSeg {
            start_cs: segment.start_timestamp(),
            end_cs: segment.end_timestamp(),
            text: trimmed.to_string(),
        });
    }

    // 7) Re-chunk segments according to max_segment_length / max_characters_per_segment
    #[derive(Debug, Clone)]
    struct Chunk {
        start_cs: i64,
        end_cs: i64,
        text: String,
    }

    let use_duration_limit = max_segment_length > 0;
    let max_segment_length_cs: i64 = (max_segment_length as i64) * 100; // seconds -> centiseconds
    let use_char_limit = max_characters_per_segment > 0;

    let mut chunks: Vec<Chunk> = Vec::new();
    let mut current: Option<Chunk> = None;

    for seg in raw_segments {
        if let Some(ref mut chunk) = current {
            // try to append seg to current chunk (if within limits)
            let new_start_cs = chunk.start_cs;
            let new_end_cs = seg.end_cs;

            let duration_ok = if use_duration_limit {
                let dur_cs = new_end_cs - new_start_cs;
                dur_cs <= max_segment_length_cs
            } else {
                true
            };

            let new_text = if chunk.text.is_empty() {
                seg.text.clone()
            } else {
                format!("{} {}", chunk.text, seg.text)
            };

            let chars_ok = if use_char_limit {
                new_text.chars().count() as u32 <= max_characters_per_segment
            } else {
                true
            };

            if duration_ok && chars_ok {
                // extend current chunk
                chunk.end_cs = new_end_cs;
                chunk.text = new_text;
            } else {
                // close current chunk and start a new one
                let finished = std::mem::replace(
                    chunk,
                    Chunk {
                        start_cs: seg.start_cs,
                        end_cs: seg.end_cs,
                        text: seg.text.clone(),
                    },
                );
                chunks.push(finished);
            }
        } else {
            // first chunk
            current = Some(Chunk {
                start_cs: seg.start_cs,
                end_cs: seg.end_cs,
                text: seg.text.clone(),
            });
        }
    }

    if let Some(chunk) = current {
        chunks.push(chunk);
    }

    // 8) Prepare output files
    let (srt_path, txt_path) = derive_output_paths(wav_path, write_srt, write_txt);
    let mut srt_file = if let Some(ref p) = srt_path {
        Some(File::create(p).map_err(|e| format!("Failed to create SRT: {e}"))?)
    } else {
        None
    };

    let mut txt_file = if let Some(ref p) = txt_path {
        Some(File::create(p).map_err(|e| format!("Failed to create TXT: {e}"))?)
    } else {
        None
    };

    // 9) Write chunks + build full_text
    let mut full_text = String::new();

    for (i, chunk) in chunks.iter().enumerate() {
        let start = format_timestamp(chunk.start_cs);
        let end = format_timestamp(chunk.end_cs);
        let text_trimmed = chunk.text.trim();

        if !full_text.is_empty() {
            full_text.push(' ');
        }
        full_text.push_str(text_trimmed);

        if let Some(f) = srt_file.as_mut() {
            writeln!(f, "{}", i + 1).map_err(|e| format!("Failed to write SRT: {e}"))?;
            writeln!(f, "{} --> {}", start, end).map_err(|e| format!("Failed to write SRT: {e}"))?;
            writeln!(f, "{}", text_trimmed).map_err(|e| format!("Failed to write SRT: {e}"))?;
            writeln!(f).map_err(|e| format!("Failed to write SRT: {e}"))?;
        }

        if let Some(f) = txt_file.as_mut() {
            writeln!(f, "{}", text_trimmed).map_err(|e| format!("Failed to write TXT: {e}"))?;
        }
    }

    Ok(full_text)
}