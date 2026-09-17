export type SpeakerRole = "me" | "remote";

export interface TranscriptSegment {
  id: string;
  meetingId: string;
  speaker: SpeakerRole;
  speakerLabel: string;
  text: string;
  timestampMs: number;
  confidence?: number;
}

export interface TopicItem {
  name: string;
  consensus: string;
  key_points: string[];
}

export interface ActionItem {
  id?: string;
  owner: string;
  task: string;
  due_date: string;
  completed?: boolean;
}

export interface MeetingSummary {
  title: string;
  summary: string;
  topics: TopicItem[];
  action_items: ActionItem[];
  generated_at?: string;
}

export interface Meeting {
  id: string;
  title: string;
  createdAt: string;
  durationSeconds: number;
  segments: TranscriptSegment[];
  summary?: MeetingSummary | null;
  tags?: string[];
  audioFileMic?: string;
  audioFileSpeaker?: string;
}

export interface AudioDeviceInfo {
  id: string;
  name: string;
  isDefault: boolean;
  kind: "input" | "output";
}

export interface RecordingState {
  isRecording: boolean;
  isPaused: boolean;
  durationSeconds: number;
  activeMeetingId: string | null;
  micLevel: number;      // 0.0 - 1.0 (实时麦克风音量)
  speakerLevel: number;  // 0.0 - 1.0 (实时扬声器音量)
}

export interface AppSettings {
  selectedMicDevice: string;
  selectedSpeakerDevice: string;
  asrMode: "local" | "cloud";
  asrLanguage: "zh" | "en" | "auto";
  llmProvider: "ollama" | "deepseek" | "openai" | "custom";
  llmApiKey: string;
  llmApiBaseUrl: string;
  llmModel: string;
  autoSummaryOnStop: boolean;
  isMockMode: boolean;
}

export interface LlmConfig {
  provider: "ollama" | "deepseek" | "openai" | "custom";
  model: string;
  apiKey?: string;
  apiBaseUrl?: string;
}

export interface OllamaStatus {
  isRunning: boolean;
  models: string[];
  url: string;
  error?: string | null;
}

export interface AsrModelStatus {
  isReady: boolean;
  modelDir: string;
  modelFile?: string | null;
  tokensFile?: string | null;
  modelSizeBytes: number;
  modelSizeMb: number;
}

export interface ModelDownloadProgress {
  fileName: string;
  downloadedBytes: number;
  totalBytes: number;
  percentage: number;
  isCompleted: boolean;
  error?: string | null;
}

