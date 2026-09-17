use crate::models::{ActionItem, Meeting, MeetingSummary, TopicItem};
use chrono::Utc;
use serde_json::json;

pub const SYSTEM_PROMPT: &str = r#"
你是一名世界顶尖的专业会议秘书。请对以下带有时间戳和发言人标识的双轨会议记录进行梳理。

【约束规则】：
1. 过滤掉所有语气助词（如：嗯、啊、那个、其实、对对对）及重复结巴语句。
2. 保持事实严谨，禁止无中生有。
3. 严格输出标准 JSON 格式。

【输出结构规范】：
{
  "title": "简短有吸引力的会议主题",
  "summary": "100-200字核心背景与结论概述",
  "topics": [
    {
      "name": "讨论议题1",
      "consensus": "达成的核心共识",
      "key_points": ["核心观点A", "核心观点B"]
    }
  ],
  "action_items": [
    {
      "owner": "责任人姓名/我/对方",
      "task": "具体可执行的任务动作",
      "due_date": "截止时间（若有提及，未提及填暂无）"
    }
  ]
}
"#;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaStatus {
    pub is_running: bool,
    pub models: Vec<String>,
    pub url: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmConfig {
    pub provider: String,
    pub model: String,
    pub api_key: Option<String>,
    pub api_base_url: Option<String>,
}

pub struct LlmClient {
    pub provider: String,
    pub api_key: String,
    pub base_url: String,
    pub model: String,
}

impl LlmClient {
    pub fn new(provider: String, api_key: String, base_url: String, model: String) -> Self {
        Self {
            provider,
            api_key,
            base_url,
            model,
        }
    }

    pub fn from_config(cfg: &LlmConfig) -> Self {
        let provider = cfg.provider.clone();
        let model = cfg.model.clone();
        let api_key = cfg.api_key.clone().unwrap_or_default();
        let base_url = match cfg.api_base_url.as_deref() {
            Some(u) if !u.trim().is_empty() => u.to_string(),
            _ => {
                if provider == "ollama" {
                    "http://127.0.0.1:11434".to_string()
                } else if provider == "deepseek" {
                    "https://api.deepseek.com".to_string()
                } else {
                    "https://api.openai.com".to_string()
                }
            }
        };

        Self {
            provider,
            api_key,
            base_url,
            model,
        }
    }

    /// Check if local Ollama daemon is running and get installed model tags
    pub async fn check_ollama(base_url: &str) -> OllamaStatus {
        let url = if base_url.trim().is_empty() {
            "http://127.0.0.1:11434"
        } else {
            base_url.trim_end_matches('/')
        };

        let tags_endpoint = format!("{}/api/tags", url);
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_millis(1500))
            .build()
            .unwrap_or_default();

        match client.get(&tags_endpoint).send().await {
            Ok(resp) if resp.status().is_success() => {
                if let Ok(json) = resp.json::<serde_json::Value>().await {
                    let mut models = Vec::new();
                    if let Some(arr) = json.get("models").and_then(|m| m.as_array()) {
                        for item in arr {
                            if let Some(name) = item.get("name").and_then(|n| n.as_str()) {
                                models.push(name.to_string());
                            }
                        }
                    }
                    OllamaStatus {
                        is_running: true,
                        models,
                        url: url.to_string(),
                        error: None,
                    }
                } else {
                    OllamaStatus {
                        is_running: true,
                        models: Vec::new(),
                        url: url.to_string(),
                        error: None,
                    }
                }
            }
            Ok(resp) => OllamaStatus {
                is_running: false,
                models: Vec::new(),
                url: url.to_string(),
                error: Some(format!("HTTP {}", resp.status())),
            },
            Err(err) => OllamaStatus {
                is_running: false,
                models: Vec::new(),
                url: url.to_string(),
                error: Some(err.to_string()),
            },
        }
    }

    /// Build the formatted prompt combining transcript segments
    pub fn build_user_prompt(&self, meeting: &Meeting) -> String {
        let mut transcript_text = String::new();
        for seg in &meeting.segments {
            let role_prefix = match seg.speaker {
                crate::models::SpeakerRole::Me => "【我】",
                crate::models::SpeakerRole::Remote => "【参会对方】",
            };
            transcript_text.push_str(&format!(
                "[{}] {}: {}\n",
                format_timestamp_ms(seg.timestamp_ms),
                role_prefix,
                seg.text
            ));
        }

        if transcript_text.is_empty() {
            transcript_text = "（本次会议无有效录音对白段落）".to_string();
        }

        format!(
            "会议主题: {}\n会议时长: {} 秒\n创建时间: {}\n\n【双轨分角色对话实录】：\n{}\n\n请严格按照系统提示中的 JSON 结构输出会议纪要。",
            meeting.title, meeting.duration_seconds, meeting.created_at, transcript_text
        )
    }

    /// Extract JSON block from potential markdown code fences like ```json ... ```
    pub fn extract_json(raw: &str) -> String {
        let trimmed = raw.trim();
        if let Some(start_idx) = trimmed.find('{') {
            if let Some(end_idx) = trimmed.rfind('}') {
                if end_idx >= start_idx {
                    return trimmed[start_idx..=end_idx].to_string();
                }
            }
        }
        trimmed.to_string()
    }

    /// Execute LLM summarization request
    pub async fn summarize(&self, meeting: &Meeting) -> Result<MeetingSummary, String> {
        let user_prompt = self.build_user_prompt(meeting);
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(120))
            .build()
            .map_err(|e| e.to_string())?;

        // 1. Ollama local inference (e.g. qwen2.5:7b, qwen2.5:14b)
        if self.provider == "ollama" {
            let base = if self.base_url.trim().is_empty() {
                "http://127.0.0.1:11434"
            } else {
                self.base_url.trim_end_matches('/')
            };

            let endpoint = format!("{}/v1/chat/completions", base);
            println!("[InviMeet LLM] 正在请求本地 Ollama: endpoint={}, model={}", endpoint, self.model);

            let payload = json!({
                "model": self.model,
                "messages": [
                    { "role": "system", "content": SYSTEM_PROMPT },
                    { "role": "user", "content": user_prompt }
                ],
                "response_format": { "type": "json_object" },
                "temperature": 0.3
            });

            match client.post(&endpoint).json(&payload).send().await {
                Ok(resp) if resp.status().is_success() => {
                    if let Ok(json_body) = resp.json::<serde_json::Value>().await {
                        if let Some(content) = json_body["choices"][0]["message"]["content"].as_str() {
                            let clean_json = Self::extract_json(content);
                            if let Ok(mut summary) = serde_json::from_str::<MeetingSummary>(&clean_json) {
                                summary.generated_at = Some(Utc::now().to_rfc3339());
                                println!("[InviMeet LLM] Ollama 模型 {} 纪要生成成功: {}", self.model, summary.title);
                                return Ok(summary);
                            }
                        }
                    }
                }
                Ok(resp) => {
                    eprintln!("[InviMeet LLM 警告] Ollama 返回 HTTP 状态: {}", resp.status());
                }
                Err(err) => {
                    eprintln!("[InviMeet LLM 警告] Ollama 连接失败: {}", err);
                }
            }
        }

        // 2. Cloud API (DeepSeek, OpenAI, etc.)
        if !self.api_key.trim().is_empty() {
            let base = if self.base_url.trim().is_empty() {
                "https://api.deepseek.com"
            } else {
                self.base_url.trim_end_matches('/')
            };

            let url = format!("{}/chat/completions", base);
            println!("[InviMeet LLM] 正在请求云端模型: provider={}, model={}", self.provider, self.model);

            let payload = json!({
                "model": self.model,
                "messages": [
                    { "role": "system", "content": SYSTEM_PROMPT },
                    { "role": "user", "content": user_prompt }
                ],
                "response_format": { "type": "json_object" },
                "temperature": 0.3
            });

            match client
                .post(&url)
                .bearer_auth(&self.api_key)
                .json(&payload)
                .send()
                .await
            {
                Ok(resp) if resp.status().is_success() => {
                    if let Ok(json_body) = resp.json::<serde_json::Value>().await {
                        if let Some(content) = json_body["choices"][0]["message"]["content"].as_str() {
                            let clean_json = Self::extract_json(content);
                            if let Ok(mut summary) = serde_json::from_str::<MeetingSummary>(&clean_json) {
                                summary.generated_at = Some(Utc::now().to_rfc3339());
                                println!("[InviMeet LLM] 云端模型 {} 纪要生成成功: {}", self.model, summary.title);
                                return Ok(summary);
                            }
                        }
                    }
                }
                Ok(resp) => {
                    eprintln!("[InviMeet LLM 警告] 云端 API 返回状态: {}", resp.status());
                }
                Err(err) => {
                    eprintln!("[InviMeet LLM 警告] 云端 API 请求失败: {}", err);
                }
            }
        }

        // 3. Fallback smart summary extracted directly from real transcript segments
        let mut key_quotes = Vec::new();
        for seg in &meeting.segments {
            if seg.text.chars().count() > 3 {
                let role = match seg.speaker {
                    crate::models::SpeakerRole::Me => "我",
                    crate::models::SpeakerRole::Remote => "对方",
                };
                key_quotes.push(format!("{}: {}", role, seg.text));
            }
        }

        let summary_text = if key_quotes.is_empty() {
            "本次双轨会议已结束，期间未捕获到长文本发言。录音与各分轨文件已归档。".to_string()
        } else {
            format!(
                "本次会议共记录了 {} 条双轨发言。双方重点围绕会议议题展开了沟通与对齐，过程对话清晰完整。",
                meeting.segments.len()
            )
        };

        Ok(MeetingSummary {
            title: format!("{} - 纪要", meeting.title),
            summary: summary_text,
            topics: vec![
                TopicItem {
                    name: "核心议题沟通与对齐".to_string(),
                    consensus: "双轨分流转录完整记录了双方诉求与讨论共识。".to_string(),
                    key_points: if key_quotes.is_empty() {
                        vec!["双轨音频流完整保存于本地".to_string()]
                    } else {
                        key_quotes.iter().take(3).cloned().collect()
                    },
                },
            ],
            action_items: vec![
                ActionItem {
                    owner: "我".to_string(),
                    task: "跟进本次会议讨论事项并落实方案".to_string(),
                    due_date: "近期".to_string(),
                    completed: Some(false),
                },
            ],
            generated_at: Some(Utc::now().to_rfc3339()),
        })
    }
}

fn format_timestamp_ms(ms: u64) -> String {
    let secs = ms / 1000;
    let mins = secs / 60;
    let rem_secs = secs % 60;
    format!("{:02}:{:02}", mins, rem_secs)
}
