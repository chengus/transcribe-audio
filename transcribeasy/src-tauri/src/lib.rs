use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TranscriptionRequest {
    file_path: String,
    output_format: OutputFormat,
    model: String,
    max_segment_length: u32,
    max_characters_per_segment: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
enum OutputFormat {
    Srt,
    Txt,
    Both,
}

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn log_transcription_parameters(request: TranscriptionRequest) -> Result<(), String> {
    println!("Received transcription request:");
    println!("  File path: {}", request.file_path);
    println!("  Output format: {:?}", request.output_format);
    println!("  Model: {}", request.model);
    println!("  Max segment length (seconds): {}", request.max_segment_length);
    println!(
        "  Max characters per segment: {}",
        request.max_characters_per_segment
    );
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![log_transcription_parameters])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
