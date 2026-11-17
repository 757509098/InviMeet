import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import {
  Meeting,
  TranscriptSegment,
  SpeakerRole,
  RecordingState,
  AudioDeviceInfo,
  MeetingSummary,
  AsrModelStatus,
  LlmConfig,
  OllamaStatus,
} from "@/types/meeting";

export interface AudioPermissionsState {
  hasScreenCapturePermission: boolean;
  platform: string;
}

// Check if running inside native Tauri runtime
export const isTauriEnv = (): boolean => {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
};

// Initial Mock Meeting Data for instant testing
const MOCK_MEETINGS: Meeting[] = [
  {
    id: "meet-demo-01",
    title: "InviMeet 核心架构与音频管线评审会",
    createdAt: new Date(Date.now() - 3600 * 1000 * 4).toISOString(),
    durationSeconds: 1420,
    tags: ["技术架构", "Q3规划"],
    segments: [
      {
        id: "s-1",
        meetingId: "meet-demo-01",
        speaker: "me",
        speakerLabel: "我 (Host)",
        text: "大家好，今天主要对齐 InviMeet 的双轨音频采集和 Tauri 2.0 骨架选型方案。",
        timestampMs: 1200,
      },
      {
        id: "s-2",
        meetingId: "meet-demo-01",
        speaker: "remote",
        speakerLabel: "参会对方 (技术负责人)",
        text: "关于 Windows WASAPI 扬声器环回采集，我们确认必须用 cpal 且锁定 16kHz 重采样，避免采样率突变导致花栗鼠杂音。",
        timestampMs: 5400,
      },
      {
        id: "s-3",
        meetingId: "meet-demo-01",
        speaker: "me",
        speakerLabel: "我 (Host)",
        text: "赞同，Mac 端用 ScreenCaptureKit 音频模式免去虚拟声卡安装。会后纪要直接调本地或云端 DeepSeek 生成。",
        timestampMs: 12100,
      },
      {
        id: "s-4",
        meetingId: "meet-demo-01",
        speaker: "remote",
        speakerLabel: "参会对方 (产品经理)",
        text: "置顶悬浮胶囊要支持全局快捷键唤起，并且保证在全屏播放 PPT 时能悬浮吸附在顶部。",
        timestampMs: 18300,
      },
    ],
    summary: {
      title: "InviMeet 核心架构与双轨音频技术评审",
      summary:
        "本次会议确定了 InviMeet 桌面端基于 Tauri 2.0 的技术框架。重点敲定了 Windows (WASAPI Loopback) 与 macOS (ScreenCaptureKit) 免驱动双轨音频截取方案，统一在 Rust 层完成 16kHz 单声道重采样，并确立了极简置顶悬浮胶囊和基于大模型的结构化会议纪要规范。",
      topics: [
        {
          name: "双平台音频截流方案",
          consensus: "废弃第三方虚拟声卡方案，统一采用 OS 原生免驱动截取机制。",
          key_points: [
            "Windows 端采用 WASAPI Loopback",
            "macOS 端采用 ScreenCaptureKit Audio-Only 截流",
            "Rust 统一执行 16kHz 单声道重采样",
          ],
        },
        {
          name: "桌面宿主与交互形式",
          consensus: "主窗口为双栏工作台，常驻状态使用无边框透明极简悬浮小胶囊。",
          key_points: [
            "悬浮窗置顶且支持拖拽",
            "显示实时麦克风与对方音量波形动画",
            "支持一键唤起主仪表板",
          ],
        },
      ],
      action_items: [
        {
          owner: "技术团队",
          task: "在 Rust 命令行验证 WASAPI Loopback 和 SCKit 音频切片录制",
          due_date: "本周五",
          completed: true,
        },
        {
          owner: "我",
          task: "完善 Prompt 工程规范与本地 SQLite 加密数据存储",
          due_date: "下周二",
          completed: false,
        },
      ],
      generated_at: new Date(Date.now() - 3600 * 1000 * 3.8).toISOString(),
    },
  },
];

// Mock state storage
let mockMeetings: Meeting[] = (() => {
  if (typeof window !== "undefined") {
    const saved = localStorage.getItem("invimeet_mock_meetings");
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error(e);
      }
    }
  }
  return MOCK_MEETINGS;
})();

const saveMockMeetings = () => {
  if (typeof window !== "undefined") {
    localStorage.setItem("invimeet_mock_meetings", JSON.stringify(mockMeetings));
  }
};

let mockRecordingState: RecordingState = {
  isRecording: false,
  isPaused: false,
  durationSeconds: 0,
  activeMeetingId: null,
  micLevel: 0,
  speakerLevel: 0,
};

let mockInterval: number | null = null;
let mockSpeechInterval: number | null = null;

// Event listeners registry for Mock mode
type EventCallback<T = any> = (payload: T) => void;
const mockEventBus: { [key: string]: EventCallback[] } = {};

const triggerMockEvent = (event: string, payload: any) => {
  const cbs = mockEventBus[event];
  if (cbs) {
    cbs.forEach((cb) => cb(payload));
  }
};

// Audio ObjectURL Cache
const audioUrlCache = new Map<string, string>();

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

function generateMockAudioWavUrl(speaker?: string): string {
  const sampleRate = 16000;
  const durationSec = 180; // 3 minutes mock track
  const numSamples = sampleRate * durationSec;
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);

  // RIFF header
  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + numSamples * 2, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // 1 channel mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); // Block align
  view.setUint16(34, 16, true); // 16 bits
  writeString(view, 36, "data");
  view.setUint32(40, numSamples * 2, true);

  const freq = speaker === "me" ? 360 : 500;
  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    // Cadence modulation mimicking human speech phrases
    const speechEnvelope = Math.sin(t * 3.5) > -0.2 ? 0.28 : 0.02;
    const sample = Math.sin(2 * Math.PI * freq * t) * speechEnvelope;
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }

  const blob = new Blob([buffer], { type: "audio/wav" });
  return URL.createObjectURL(blob);
}

export const TauriBridge = {
  // Listen to Tauri events (or mock fallback)
  async onEvent<T>(
    event: string,
    callback: (payload: T) => void
  ): Promise<UnlistenFn> {
    if (isTauriEnv()) {
      return await listen<T>(event, (e) => callback(e.payload));
    } else {
      if (!mockEventBus[event]) {
        mockEventBus[event] = [];
      }
      mockEventBus[event].push(callback);
      return () => {
        mockEventBus[event] = mockEventBus[event].filter((cb) => cb !== callback);
      };
    }
  },

  // Audio & Recording Commands
  async startRecording(title?: string): Promise<{ meetingId: string }> {
    if (isTauriEnv()) {
      return await invoke<{ meetingId: string }>("start_recording", { title });
    }

    // Mock implementation
    const meetingId = `meet-${Date.now()}`;
    const newMeeting: Meeting = {
      id: meetingId,
      title: title || `会议记录 ${new Date().toLocaleDateString()}`,
      createdAt: new Date().toISOString(),
      durationSeconds: 0,
      segments: [],
      summary: null,
      tags: ["实时录音"],
    };
    mockMeetings.unshift(newMeeting);
    saveMockMeetings();

    mockRecordingState = {
      isRecording: true,
      isPaused: false,
      durationSeconds: 0,
      activeMeetingId: meetingId,
      micLevel: 0.2,
      speakerLevel: 0.1,
    };

    // Simulate Audio level animation & timer
    if (mockInterval) clearInterval(mockInterval);
    mockInterval = window.setInterval(() => {
      if (mockRecordingState.isRecording && !mockRecordingState.isPaused) {
        mockRecordingState.durationSeconds += 1;
        mockRecordingState.micLevel = Math.random() > 0.4 ? Math.random() * 0.7 + 0.1 : 0.05;
        mockRecordingState.speakerLevel = Math.random() > 0.5 ? Math.random() * 0.8 + 0.1 : 0.02;

        triggerMockEvent("audio-level", {
          micLevel: mockRecordingState.micLevel,
          speakerLevel: mockRecordingState.speakerLevel,
        });

        triggerMockEvent("recording-state-changed", mockRecordingState);
      }
    }, 1000);

    // Simulate real-time speech transcription stream
    if (mockSpeechInterval) clearInterval(mockSpeechInterval);
    const mockPhrases = [
      { speaker: "me" as const, text: "我们开始测试双轨分离算法，大家能清楚听到吗？" },
      { speaker: "remote" as const, text: "听得很清楚，扬声器环回流抓取正常，信噪比很高。" },
      { speaker: "me" as const, text: "好的，下一步把这些片段直接接入 ASR 语音识别和重采样。" },
      { speaker: "remote" as const, text: "收到，大语言模型提示词结构已经就绪，录音结束可立即输出纪要。" },
    ];
    let phraseIdx = 0;

    mockSpeechInterval = window.setInterval(() => {
      if (mockRecordingState.isRecording && !mockRecordingState.isPaused) {
        const item = mockPhrases[phraseIdx % mockPhrases.length];
        phraseIdx++;
        const segment: TranscriptSegment = {
          id: `seg-${Date.now()}`,
          meetingId,
          speaker: item.speaker,
          speakerLabel: item.speaker === "me" ? "我" : "参会对方",
          text: item.text,
          timestampMs: mockRecordingState.durationSeconds * 1000,
        };

        const target = mockMeetings.find((m) => m.id === meetingId);
        if (target) {
          target.segments.push(segment);
          target.durationSeconds = mockRecordingState.durationSeconds;
          saveMockMeetings();
        }

        triggerMockEvent("transcript-segment", segment);
      }
    }, 5000);

    return { meetingId };
  },

  async stopRecording(): Promise<Meeting> {
    if (isTauriEnv()) {
      return await invoke<Meeting>("stop_recording");
    }

    if (mockInterval) clearInterval(mockInterval);
    if (mockSpeechInterval) clearInterval(mockSpeechInterval);

    const activeId = mockRecordingState.activeMeetingId;
    mockRecordingState = {
      isRecording: false,
      isPaused: false,
      durationSeconds: 0,
      activeMeetingId: null,
      micLevel: 0,
      speakerLevel: 0,
    };
    triggerMockEvent("recording-state-changed", mockRecordingState);

    const target = mockMeetings.find((m) => m.id === activeId);
    if (target) {
      target.durationSeconds = Math.max(target.durationSeconds, 12);
      saveMockMeetings();
      return target;
    }

    return mockMeetings[0];
  },

  async getRecordingState(): Promise<RecordingState> {
    if (isTauriEnv()) {
      return await invoke<RecordingState>("get_recording_state");
    }
    return mockRecordingState;
  },

  // Meetings CRUD
  async getMeetings(): Promise<Meeting[]> {
    if (isTauriEnv()) {
      return await invoke<Meeting[]>("get_meetings");
    }
    return [...mockMeetings];
  },

  async getMeetingDetail(id: string): Promise<Meeting | null> {
    if (isTauriEnv()) {
      return await invoke<Meeting | null>("get_meeting_detail", { id });
    }
    return mockMeetings.find((m) => m.id === id) || null;
  },

  // AI Summary Generation
  async generateSummary(meetingId: string, config?: LlmConfig): Promise<MeetingSummary> {
    if (isTauriEnv()) {
      return await invoke<MeetingSummary>("generate_summary", { meetingId, config });
    }

    // Mock LLM generation simulation (matches PRD structure)
    const target = mockMeetings.find((m) => m.id === meetingId);
    const mockSummary: MeetingSummary = {
      title: target?.title ? `${target.title} - AI 核心决议` : "会议纪要",
      summary:
        "本次双轨会议重点评估了音频采集的实时性和角色物理分离度。参会各方对当前麦克风和扬声器两条独立管线的对齐表现达成高度一致，并确定了后续本地轻量模型接入方案。",
      topics: [
        {
          name: "双轨音频捕获与延迟控制",
          consensus: "延迟控制在 200ms 以内，角色物理切分准确率达标。",
          key_points: [
            "双通道 PCM 帧对齐",
            "重采样至 16kHz 无失真",
          ],
        },
        {
          name: "待办交付进度",
          consensus: "下一周开始验证 Windows/Mac 两端安装包与桌面悬浮小胶囊拖拽吸附。",
          key_points: ["全屏窗口置顶", "快捷键触发机制"],
        },
      ],
      action_items: [
        {
          owner: "我",
          task: "完成 Tauri 2.0 基础框架与置顶胶囊交互联调",
          due_date: "本周内",
          completed: false,
        },
        {
          owner: "参会对方",
          task: "接入 Whisper.cpp 与 DeepSeek API 纪要提炼管线",
          due_date: "下周三",
          completed: false,
        },
      ],
      generated_at: new Date().toISOString(),
    };

    if (target) {
      target.summary = mockSummary;
      saveMockMeetings();
    }

    return mockSummary;
  },

  // Audio Devices & Permissions
  async getAudioDevices(): Promise<AudioDeviceInfo[]> {
    if (isTauriEnv()) {
      return await invoke<AudioDeviceInfo[]>("get_audio_devices");
    }
    return [
      { id: "default_mic", name: "MacBook 内建麦克风 (默认)", isDefault: true, kind: "input" },
      { id: "airpods_mic", name: "AirPods Pro 麦克风", isDefault: false, kind: "input" },
      { id: "default_speaker", name: "MacBook 内建扬声器 (默认环回)", isDefault: true, kind: "output" },
      { id: "airpods_out", name: "AirPods Pro 蓝牙立体声", isDefault: false, kind: "output" },
    ];
  },

  async checkAudioPermissions(): Promise<AudioPermissionsState> {
    if (isTauriEnv()) {
      return await invoke<AudioPermissionsState>("check_audio_permissions");
    }
    return { hasScreenCapturePermission: true, platform: "web" };
  },

  async requestAudioPermissions(): Promise<boolean> {
    if (isTauriEnv()) {
      return await invoke<boolean>("request_audio_permissions");
    }
    return true;
  },

  // Offline ASR Model Management
  async checkAsrModelStatus(): Promise<AsrModelStatus> {
    if (isTauriEnv()) {
      return await invoke<AsrModelStatus>("check_asr_model_status");
    }
    return {
      isReady: true,
      modelDir: "/mock/models/sense-voice-small",
      modelFile: "/mock/models/sense-voice-small/model.int8.onnx",
      tokensFile: "/mock/models/sense-voice-small/tokens.txt",
      modelSizeBytes: 145000000,
      modelSizeMb: 138.3,
    };
  },

  async downloadAsrModel(): Promise<void> {
    if (isTauriEnv()) {
      await invoke("download_asr_model");
    } else {
      triggerMockEvent("asr-model-download-progress", {
        fileName: "model.int8.onnx",
        downloadedBytes: 145000000,
        totalBytes: 145000000,
        percentage: 100,
        isCompleted: true,
      });
    }
  },

  // Window Management
  async openMainWindow(): Promise<void> {
    if (isTauriEnv()) {
      await invoke("open_main_window");
    } else {
      window.location.search = "?window=main";
    }
  },

  async togglePillWindow(): Promise<void> {
    if (isTauriEnv()) {
      await invoke("toggle_pill_window");
    } else {
      window.location.search = "?window=pill";
    }
  },

  // Ollama Status Check
  async checkOllamaStatus(url?: string): Promise<OllamaStatus> {
    if (isTauriEnv()) {
      return await invoke<OllamaStatus>("check_ollama_status", { url });
    }
    return {
      isRunning: false,
      models: ["qwen2.5:7b", "qwen2.5:14b"],
      url: url || "http://127.0.0.1:11434",
    };
  },

  // Audio Playback File Loading & Cache
  async readAudioFile(filePath: string): Promise<ArrayBuffer> {
    if (isTauriEnv()) {
      const bytes = await invoke<number[] | Uint8Array | ArrayBuffer>("read_audio_file", { filePath });
      if (bytes instanceof ArrayBuffer) return bytes;
      const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes as any);
      return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
    }
    throw new Error("readAudioFile is only supported in native Tauri runtime");
  },

  async getAudioUrl(filePath?: string, speaker?: SpeakerRole): Promise<string> {
    if (filePath && audioUrlCache.has(filePath)) {
      return audioUrlCache.get(filePath)!;
    }

    if (isTauriEnv() && filePath) {
      try {
        const buffer = await this.readAudioFile(filePath);
        const blob = new Blob([buffer], { type: "audio/wav" });
        const url = URL.createObjectURL(blob);
        audioUrlCache.set(filePath, url);
        return url;
      } catch (err) {
        console.warn(`[InviMeet Audio] Failed to read native audio '${filePath}':`, err);
      }
    }

    // Fallback/Mock Audio generator for web preview or missing recordings
    const fallbackKey = `mock-audio-${speaker || "me"}`;
    if (audioUrlCache.has(fallbackKey)) {
      return audioUrlCache.get(fallbackKey)!;
    }

    const mockUrl = generateMockAudioWavUrl(speaker);
    audioUrlCache.set(fallbackKey, mockUrl);
    return mockUrl;
  },

  // Export
  exportMeetingMarkdown(meeting: Meeting): string {
    let md = `# ${meeting.title}\n\n`;
    md += `- **时间**: ${new Date(meeting.createdAt).toLocaleString()}\n`;
    md += `- **时长**: ${Math.floor(meeting.durationSeconds / 60)}分${meeting.durationSeconds % 60}秒\n\n`;

    if (meeting.summary) {
      md += `## 一、会议核心摘要\n\n${meeting.summary.summary}\n\n`;
      md += `## 二、核心议题与共识\n\n`;
      meeting.summary.topics.forEach((t, i) => {
        md += `### ${i + 1}. ${t.name}\n`;
        md += `> **核心共识**：${t.consensus}\n\n`;
        t.key_points.forEach((kp) => {
          md += `- ${kp}\n`;
        });
        md += `\n`;
      });

      md += `## 三、待办清单 (Action Items)\n\n`;
      meeting.summary.action_items.forEach((item) => {
        const check = item.completed ? "[x]" : "[ ]";
        md += `- ${check} **${item.owner}**：${item.task} *(截止: ${item.due_date})*\n`;
      });
      md += `\n`;
    }

    md += `## 四、双轨实时转录记录\n\n`;
    meeting.segments.forEach((seg) => {
      const mins = Math.floor(seg.timestampMs / 60000);
      const secs = Math.floor((seg.timestampMs % 60000) / 1000);
      const timeStr = `[${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}]`;
      const prefix = seg.speaker === "me" ? "【我】" : "【参会对方】";
      md += `${timeStr} **${prefix}** ${seg.text}\n\n`;
    });

    return md;
  },

  exportMeetingHtml(meeting: Meeting): string {
    const mins = Math.floor(meeting.durationSeconds / 60);
    const secs = meeting.durationSeconds % 60;
    const dateStr = new Date(meeting.createdAt).toLocaleString();

    let topicsHtml = "";
    if (meeting.summary?.topics) {
      topicsHtml = meeting.summary.topics
        .map(
          (t, i) => `
        <div class="topic-card">
          <div class="topic-title">${i + 1}. ${escapeHtml(t.name)}</div>
          <div class="topic-consensus"><strong>核心共识：</strong>${escapeHtml(t.consensus)}</div>
          <ul class="key-points">
            ${t.key_points.map((p) => `<li>${escapeHtml(p)}</li>`).join("")}
          </ul>
        </div>`
        )
        .join("");
    }

    let actionItemsHtml = "";
    if (meeting.summary?.action_items) {
      actionItemsHtml = meeting.summary.action_items
        .map(
          (item) => `
        <li class="action-item ${item.completed ? "completed" : ""}">
          <span class="action-checkbox">${item.completed ? "☑" : "☐"}</span>
          <span class="action-owner">${escapeHtml(item.owner)}</span>
          <span class="action-task">${escapeHtml(item.task)}</span>
          <span class="action-due">截止: ${escapeHtml(item.due_date)}</span>
        </li>`
        )
        .join("");
    }

    let transcriptHtml = meeting.segments
      .map((seg) => {
        const segMins = Math.floor(seg.timestampMs / 60000);
        const segSecs = Math.floor((seg.timestampMs % 60000) / 1000);
        const timeStr = `${String(segMins).padStart(2, "0")}:${String(segSecs).padStart(2, "0")}`;
        const isMe = seg.speaker === "me";
        return `
        <div class="bubble-row ${isMe ? "me" : "remote"}">
          <div class="bubble-meta">
            <span class="bubble-role">${isMe ? "我" : "参会对方"}</span>
            <span class="bubble-time">${timeStr}</span>
          </div>
          <div class="bubble-text">${escapeHtml(seg.text)}</div>
        </div>`;
      })
      .join("");

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(meeting.title)} - 会议纪要与实录</title>
  <style>
    @media print {
      body { background: white !important; color: #1e293b !important; padding: 0 !important; }
      .container { max-width: 100% !important; box-shadow: none !important; border: none !important; }
      .no-print { display: none !important; }
      .topic-card, .summary-box { border: 1px solid #cbd5e1 !important; background: #f8fafc !important; color: #1e293b !important; }
      .bubble-row.me .bubble-text { background: #e0e7ff !important; color: #1e1b4b !important; }
      .bubble-row.remote .bubble-text { background: #f1f5f9 !important; color: #0f172a !important; }
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
      background: #090d16;
      color: #e2e8f0;
      margin: 0;
      padding: 32px 16px;
      line-height: 1.6;
    }
    .container {
      max-width: 860px;
      margin: 0 auto;
      background: #0f172a;
      border: 1px solid #1e293b;
      border-radius: 16px;
      padding: 40px;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.4);
    }
    .header { border-bottom: 1px solid #334155; padding-bottom: 24px; margin-bottom: 32px; }
    .badge { display: inline-block; padding: 4px 12px; background: rgba(99, 102, 241, 0.15); color: #818cf8; border-radius: 9999px; font-size: 12px; font-weight: 600; margin-bottom: 12px; }
    h1 { font-size: 26px; color: #ffffff; margin: 0 0 12px 0; }
    .meta-bar { display: flex; gap: 20px; font-size: 13px; color: #94a3b8; }
    .section-title { font-size: 17px; font-weight: 700; color: #f8fafc; margin: 32px 0 16px 0; display: flex; align-items: center; gap: 8px; border-left: 4px solid #6366f1; padding-left: 12px; }
    .summary-box { background: rgba(30, 41, 59, 0.7); border: 1px solid #334155; border-radius: 12px; padding: 18px 20px; font-size: 14.5px; line-height: 1.7; color: #cbd5e1; }
    .topic-card { background: rgba(30, 41, 59, 0.5); border: 1px solid #334155; border-radius: 12px; padding: 16px 20px; margin-bottom: 14px; }
    .topic-title { font-size: 15px; font-weight: 600; color: #a5b4fc; margin-bottom: 8px; }
    .topic-consensus { font-size: 13.5px; color: #e2e8f0; margin-bottom: 8px; }
    .key-points { margin: 0; padding-left: 20px; font-size: 13px; color: #94a3b8; }
    .key-points li { margin-bottom: 4px; }
    .action-list { list-style: none; padding: 0; margin: 0; display: grid; gap: 10px; }
    .action-item { display: flex; align-items: center; gap: 12px; background: rgba(30, 41, 59, 0.5); border: 1px solid #334155; border-radius: 8px; padding: 10px 16px; font-size: 13.5px; }
    .action-checkbox { font-size: 16px; color: #6366f1; }
    .action-owner { font-weight: 600; color: #818cf8; min-width: 60px; }
    .action-task { flex: 1; color: #f1f5f9; }
    .action-due { font-size: 12px; color: #94a3b8; }
    .bubble-row { margin-bottom: 16px; display: flex; flex-direction: column; }
    .bubble-row.me { align-items: flex-end; }
    .bubble-row.remote { align-items: flex-start; }
    .bubble-meta { font-size: 11.5px; color: #64748b; margin-bottom: 4px; display: flex; gap: 8px; }
    .bubble-row.me .bubble-role { color: #818cf8; font-weight: 600; }
    .bubble-row.remote .bubble-role { color: #34d399; font-weight: 600; }
    .bubble-text { max-width: 80%; padding: 10px 16px; border-radius: 12px; font-size: 14px; line-height: 1.6; }
    .bubble-row.me .bubble-text { background: #4f46e5; color: #ffffff; border-top-right-radius: 2px; }
    .bubble-row.remote .bubble-text { background: #1e293b; border: 1px solid #334155; color: #e2e8f0; border-top-left-radius: 2px; }
    .footer { margin-top: 40px; text-align: center; font-size: 12px; color: #64748b; border-top: 1px solid #1e293b; padding-top: 20px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <span class="badge">InviMeet AI 会议纪要与实录</span>
      <h1>${escapeHtml(meeting.title)}</h1>
      <div class="meta-bar">
        <span>📅 ${dateStr}</span>
        <span>⏱️ 时长：${mins}分${secs}秒</span>
        <span>💬 对话条数：${meeting.segments.length} 条</span>
      </div>
    </div>

    ${
      meeting.summary
        ? `
    <div class="section-title">一、会议核心摘要</div>
    <div class="summary-box">${escapeHtml(meeting.summary.summary)}</div>

    <div class="section-title">二、核心议题与共识</div>
    ${topicsHtml}

    <div class="section-title">三、待办清单 (Action Items)</div>
    <ul class="action-list">
      ${actionItemsHtml}
    </ul>`
        : ""
    }

    <div class="section-title">四、双轨实时转录实录</div>
    <div class="transcript-box">
      ${transcriptHtml || '<div style="color: #64748b; padding: 12px;">暂无转录记录</div>'}
    </div>

    <div class="footer">
      Generated by InviMeet • 双轨无感会议副驾
    </div>
  </div>
</body>
</html>`;
  },

  exportMeetingPdf(meeting: Meeting): void {
    const html = this.exportMeetingHtml(meeting);
    const printWin = window.open("", "_blank");
    if (printWin) {
      printWin.document.open();
      printWin.document.write(html);
      printWin.document.close();
      printWin.focus();
      setTimeout(() => {
        printWin.print();
      }, 300);
    }
  },
};

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
