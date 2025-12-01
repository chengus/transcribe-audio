use serde::Deserialize;
// declare the module
mod transcribe;
// bring the function into scope (or call it with `transcribe::transcribe_file`)
use crate::transcribe::transcribe_file;

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

#[tauri::command]
fn transcribe_command(
    model_path: String,
    wav_path: String,
    output_format: String,
    max_segment_length: u32,
    max_characters_per_segment: u32,
) -> Result<String, String> {
    transcribe_file(
        &model_path,
        &wav_path,
        &output_format,
        max_segment_length,
        max_characters_per_segment,
    )
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![transcribe_command])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
        
}
