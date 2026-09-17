use std::sync::Arc;
use tokio::sync::RwLock;
use crate::models::{Meeting, MeetingSummary, TranscriptSegment};
use chrono::Utc;

#[derive(Clone)]
pub struct MeetingStore {
    meetings: Arc<RwLock<Vec<Meeting>>>,
}

impl MeetingStore {
    pub fn new() -> Self {
        let default_meeting = Meeting {
            id: "meet-init-01".to_string(),
            title: "InviMeet 架构与双轨音频设计评审".to_string(),
            created_at: Utc::now().to_rfc3339(),
            duration_seconds: 1200,
            segments: vec![
                TranscriptSegment {
                    id: "s-1".to_string(),
                    meeting_id: "meet-init-01".to_string(),
                    speaker: crate::models::SpeakerRole::Me,
                    speaker_label: "我".to_string(),
                    text: "欢迎大家参加 InviMeet 会议副驾的技术评审。今天确认 Tauri 2.0 与双轨音频方案。".to_string(),
                    timestamp_ms: 1000,
                    confidence: Some(0.98),
                },
                TranscriptSegment {
                    id: "s-2".to_string(),
                    meeting_id: "meet-init-01".to_string(),
                    speaker: crate::models::SpeakerRole::Remote,
                    speaker_label: "参会对方".to_string(),
                    text: "经测试，Windows WASAPI Loopback 在多声卡热插拔时需要重新拉取句柄，我们已加入自动重连机制。".to_string(),
                    timestamp_ms: 5200,
                    confidence: Some(0.96),
                },
            ],
            summary: Some(MeetingSummary {
                title: "InviMeet 架构评审核心决议".to_string(),
                summary: "明确了基于 Tauri 2.0 的极简置顶悬浮胶囊与双栏工作台架构，确定双轨免驱动音频管线规范。".to_string(),
                topics: vec![
                    crate::models::TopicItem {
                        name: "系统技术选型".to_string(),
                        consensus: "采用 Tauri 2.0 + React 18 + Tailwind 搭建。".to_string(),
                        key_points: vec!["包体积小、内存低于50MB".to_string()],
                    }
                ],
                action_items: vec![
                    crate::models::ActionItem {
                        owner: "开发团队".to_string(),
                        task: "推进音频重采样与端侧 Whisper 接入".to_string(),
                        due_date: "本周".to_string(),
                        completed: Some(true),
                    }
                ],
                generated_at: Some(Utc::now().to_rfc3339()),
            }),
            tags: vec!["架构设计".to_string(), "音频管线".to_string()],
            audio_file_mic: None,
            audio_file_speaker: None,
        };

        Self {
            meetings: Arc::new(RwLock::new(vec![default_meeting])),
        }
    }

    pub async fn list(&self) -> Vec<Meeting> {
        let guard = self.meetings.read().await;
        guard.clone()
    }

    pub async fn get(&self, id: &str) -> Option<Meeting> {
        let guard = self.meetings.read().await;
        guard.iter().find(|m| m.id == id).cloned()
    }

    pub async fn insert(&self, meeting: Meeting) {
        let mut guard = self.meetings.write().await;
        guard.insert(0, meeting);
    }

    pub async fn update_meeting(&self, meeting: Meeting) {
        let mut guard = self.meetings.write().await;
        if let Some(pos) = guard.iter().position(|m| m.id == meeting.id) {
            guard[pos] = meeting;
        } else {
            guard.insert(0, meeting);
        }
    }

    pub async fn add_segment(&self, meeting_id: &str, segment: TranscriptSegment) {
        let mut guard = self.meetings.write().await;
        if let Some(m) = guard.iter_mut().find(|m| m.id == meeting_id) {
            m.segments.push(segment);
        }
    }

    pub async fn update_summary(&self, meeting_id: &str, summary: MeetingSummary) -> Option<Meeting> {
        let mut guard = self.meetings.write().await;
        if let Some(m) = guard.iter_mut().find(|m| m.id == meeting_id) {
            m.summary = Some(summary);
            return Some(m.clone());
        }
        None
    }
}
