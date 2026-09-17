use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SpeakerRole {
    Me,
    Remote,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptSegment {
    pub id: String,
    pub meeting_id: String,
    pub speaker: SpeakerRole,
    pub speaker_label: String,
    pub text: String,
    pub timestamp_ms: u64,
    pub confidence: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TopicItem {
    pub name: String,
    pub consensus: String,
    pub key_points: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActionItem {
    pub owner: String,
    pub task: String,
    pub due_date: String,
    pub completed: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MeetingSummary {
    pub title: String,
    pub summary: String,
    pub topics: Vec<TopicItem>,
    pub action_items: Vec<ActionItem>,
    pub generated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Meeting {
    pub id: String,
    pub title: String,
    pub created_at: String,
    pub duration_seconds: u64,
    pub segments: Vec<TranscriptSegment>,
    pub summary: Option<MeetingSummary>,
    pub tags: Vec<String>,
    pub audio_file_mic: Option<String>,
    pub audio_file_speaker: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioDeviceInfo {
    pub id: String,
    pub name: String,
    pub is_default: bool,
    pub kind: String, // "input" | "output"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingState {
    pub is_recording: bool,
    pub is_paused: bool,
    pub duration_seconds: u64,
    pub active_meeting_id: Option<String>,
    pub mic_level: f32,
    pub speaker_level: f32,
}
