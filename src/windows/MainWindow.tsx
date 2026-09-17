import React, { useState, useEffect } from "react";
import { Meeting, RecordingState, AppSettings, TranscriptSegment, LlmConfig, OllamaStatus } from "@/types/meeting";
import { TauriBridge } from "@/lib/tauriBridge";
import { MeetingSidebar } from "@/components/MeetingSidebar";
import { TranscriptStream } from "@/components/TranscriptStream";
import { SummaryCard } from "@/components/SummaryCard";
import { AudioWaveform } from "@/components/AudioWaveform";
import { SettingsDialog } from "@/components/SettingsDialog";
import {
  Play,
  Square,
  Sparkles,
  Download,
  Minimize2,
  Columns,
  MessageSquareText,
  FileText,
  Globe,
  Printer,
  ChevronDown,
} from "lucide-react";

export const MainWindow: React.FC = () => {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [selectedMeeting, setSelectedMeeting] = useState<Meeting | null>(null);
  const [recordingState, setRecordingState] = useState<RecordingState>({
    isRecording: false,
    isPaused: false,
    durationSeconds: 0,
    activeMeetingId: null,
    micLevel: 0,
    speakerLevel: 0,
  });

  const [activeTab, setActiveTab] = useState<"split" | "transcript" | "summary">("split");
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus | null>(null);

  const [settings, setSettings] = useState<AppSettings>({
    selectedMicDevice: "default",
    selectedSpeakerDevice: "default",
    asrMode: "local",
    asrLanguage: "zh",
    llmProvider: "deepseek",
    llmApiKey: "",
    llmApiBaseUrl: "https://api.deepseek.com",
    llmModel: "deepseek-chat",
    autoSummaryOnStop: true,
    isMockMode: false,
  });

  // Load meetings & state
  useEffect(() => {
    let isMounted = true;
    let unlistenFns: Array<() => void> = [];

    const initData = async () => {
      try {
        const list = await TauriBridge.getMeetings();
        if (isMounted && list) {
          setMeetings(list);
          if (list.length > 0) {
            setSelectedMeeting(list[0]);
          }
        }
      } catch (err) {
        console.warn("Failed to load meetings:", err);
      }

      try {
        const rec = await TauriBridge.getRecordingState();
        if (isMounted && rec) {
          setRecordingState(rec);
        }
      } catch (err) {
        console.warn("Failed to get recording state:", err);
      }

      try {
        const oStatus = await TauriBridge.checkOllamaStatus();
        if (isMounted) setOllamaStatus(oStatus);
      } catch {}
    };

    initData();

    // Event listeners
    TauriBridge.onEvent<RecordingState>("recording-state-changed", (state) => {
      if (isMounted && state) setRecordingState(state);
    })
      .then((fn) => unlistenFns.push(fn))
      .catch(() => {});

    TauriBridge.onEvent<{ micLevel: number; speakerLevel: number; durationSeconds?: number }>(
      "audio-level",
      ({ micLevel, speakerLevel, durationSeconds }) => {
        if (isMounted) {
          setRecordingState((prev) => ({
            ...prev,
            micLevel,
            speakerLevel,
            durationSeconds: durationSeconds !== undefined ? durationSeconds : prev.durationSeconds,
          }));
        }
      }
    )
      .then((fn) => unlistenFns.push(fn))
      .catch(() => {});

    TauriBridge.onEvent<TranscriptSegment>("transcript-segment", (segment) => {
      if (!isMounted || !segment) return;

      setMeetings((prevList) => {
        const exists = prevList.some((m) => m.id === segment.meetingId);
        if (exists) {
          return prevList.map((m) => {
            if (m.id === segment.meetingId) {
              return { ...m, segments: [...m.segments, segment] };
            }
            return m;
          });
        } else {
          return [
            {
              id: segment.meetingId,
              title: "实时会议",
              createdAt: new Date().toISOString(),
              durationSeconds: 0,
              segments: [segment],
            },
            ...prevList,
          ];
        }
      });

      setSelectedMeeting((prev) => {
        if (!prev || prev.id === segment.meetingId) {
          const current = prev || {
            id: segment.meetingId,
            title: "实时会议",
            createdAt: new Date().toISOString(),
            durationSeconds: 0,
            segments: [],
          };
          return { ...current, segments: [...current.segments, segment] };
        }
        return prev;
      });
    })
      .then((fn) => unlistenFns.push(fn))
      .catch(() => {});

    return () => {
      isMounted = false;
      unlistenFns.forEach((fn) => {
        try {
          fn();
        } catch {}
      });
    };
  }, []);

  // Live second timer fallback
  useEffect(() => {
    let timer: number | null = null;
    if (recordingState.isRecording) {
      timer = window.setInterval(() => {
        setRecordingState((prev) => ({
          ...prev,
          durationSeconds: prev.durationSeconds + 1,
        }));
      }, 1000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [recordingState.isRecording]);

  // Actions
  const handleStartRecording = async () => {
    try {
      // Optimistic UI state update immediately
      setRecordingState((prev) => ({
        ...prev,
        isRecording: true,
        durationSeconds: 0,
        micLevel: 0,
        speakerLevel: 0,
      }));

      const { meetingId } = await TauriBridge.startRecording();
      setRecordingState((prev) => ({
        ...prev,
        isRecording: true,
        activeMeetingId: meetingId,
      }));

      const updated = await TauriBridge.getMeetings();
      setMeetings(updated);
      const curr = updated.find((m) => m.id === meetingId);
      if (curr) {
        setSelectedMeeting(curr);
      }
    } catch (err) {
      console.error("Failed to start recording:", err);
      setRecordingState((prev) => ({ ...prev, isRecording: false }));
    }
  };

  const handleStopRecording = async () => {
    try {
      const activeId = recordingState.activeMeetingId || selectedMeeting?.id;

      // Optimistic UI state update immediately
      setRecordingState((prev) => ({
        ...prev,
        isRecording: false,
        micLevel: 0,
        speakerLevel: 0,
      }));

      const finishedMeeting = await TauriBridge.stopRecording();
      const updated = await TauriBridge.getMeetings();
      setMeetings(updated);

      const resolvedMeeting =
        finishedMeeting || (activeId ? updated.find((m) => m.id === activeId) : null) || updated[0];
      if (resolvedMeeting) {
        setSelectedMeeting(resolvedMeeting);
      }

      // Auto generate summary if enabled
      if (settings.autoSummaryOnStop && resolvedMeeting?.id) {
        handleGenerateSummary(resolvedMeeting.id);
      }
    } catch (err) {
      console.error("Failed to stop recording:", err);
      setRecordingState((prev) => ({ ...prev, isRecording: false }));
    }
  };

  const handleGenerateSummary = async (meetingId?: string, config?: LlmConfig) => {
    const targetId = meetingId || selectedMeeting?.id;
    if (!targetId) return;

    setIsGeneratingSummary(true);
    try {
      const summary = await TauriBridge.generateSummary(targetId, config);
      setSelectedMeeting((prev) => (prev ? { ...prev, summary } : prev));
      setMeetings((prevList) =>
        prevList.map((m) => (m.id === targetId ? { ...m, summary } : m))
      );
    } catch (err) {
      console.error("Failed to generate summary:", err);
    } finally {
      setIsGeneratingSummary(false);
    }
  };

  const handleExportMarkdown = () => {
    if (!selectedMeeting) return;
    setExportMenuOpen(false);
    const content = TauriBridge.exportMeetingMarkdown(selectedMeeting);
    const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${selectedMeeting.title || "会议纪要"}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportHtml = () => {
    if (!selectedMeeting) return;
    setExportMenuOpen(false);
    const content = TauriBridge.exportMeetingHtml(selectedMeeting);
    const blob = new Blob([content], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${selectedMeeting.title || "会议纪要"}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportPdf = () => {
    if (!selectedMeeting) return;
    setExportMenuOpen(false);
    TauriBridge.exportMeetingPdf(selectedMeeting);
  };

  const formatTimer = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };

  return (
    <div className="w-screen h-screen flex bg-surface-darker overflow-hidden text-slate-100 font-sans">
      {/* Sidebar */}
      <MeetingSidebar
        meetings={meetings}
        activeMeetingId={selectedMeeting?.id || null}
        onSelectMeeting={(m) => setSelectedMeeting(m)}
        onNewMeeting={handleStartRecording}
        onOpenSettings={() => setIsSettingsOpen(true)}
        isRecording={recordingState.isRecording}
      />

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 bg-surface-darker">
        {/* Top Control Bar */}
        <header
          data-tauri-drag-region
          className="h-16 border-b border-surface-border bg-surface-dark/60 backdrop-blur-md px-6 flex items-center justify-between gap-4"
        >
          {/* Title & Info */}
          <div className="min-w-0 flex items-center gap-3">
            <h2 className="text-sm font-bold text-slate-200 truncate">
              {selectedMeeting ? selectedMeeting.title : "未选择会议"}
            </h2>
            {selectedMeeting && (
              <span className="text-xs text-slate-500 bg-surface-card px-2 py-0.5 rounded-full border border-surface-border">
                {selectedMeeting.segments.length} 条发言
              </span>
            )}
          </div>

          {/* Center: Audio Waveform Visualizer */}
          {recordingState.isRecording ? (
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1.5 text-xs text-rose-400 font-medium">
                <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
                {formatTimer(recordingState.durationSeconds)}
              </span>
              <AudioWaveform
                micLevel={recordingState.micLevel}
                speakerLevel={recordingState.speakerLevel}
              />
              <span className="text-[11px] text-slate-500 hidden xl:inline-block">
                双轨录制中
              </span>
            </div>
          ) : (
            <div className="hidden lg:flex items-center gap-2 text-xs text-slate-500">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <span>双轨就绪 (麦克风 + 扬声器)</span>
            </div>
          )}

          {/* Right Action Buttons */}
          <div className="flex items-center gap-2" data-no-drag>
            {/* View Mode Switcher */}
            <div className="flex items-center bg-surface-card border border-surface-border rounded-lg p-0.5 text-xs">
              <button
                onClick={() => setActiveTab("split")}
                title="双栏并排"
                className={`p-1.5 rounded-md transition-colors ${
                  activeTab === "split" ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <Columns className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setActiveTab("transcript")}
                title="仅查看对话流"
                className={`p-1.5 rounded-md transition-colors ${
                  activeTab === "transcript" ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <MessageSquareText className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setActiveTab("summary")}
                title="仅查看 AI 纪要"
                className={`p-1.5 rounded-md transition-colors ${
                  activeTab === "summary" ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <Sparkles className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Export Dropdown Menu */}
            {selectedMeeting && (
              <div className="relative">
                <button
                  onClick={() => setExportMenuOpen((prev) => !prev)}
                  title="导出会议纪要"
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-surface-card hover:bg-surface-border text-slate-300 border border-surface-border transition-colors text-xs"
                >
                  <Download className="w-3.5 h-3.5 text-indigo-400" />
                  <span>导出</span>
                  <ChevronDown className="w-3 h-3 text-slate-400" />
                </button>

                {exportMenuOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setExportMenuOpen(false)}
                    />
                    <div className="absolute right-0 mt-1.5 w-52 bg-surface-dark border border-surface-border rounded-xl shadow-2xl py-1.5 z-50 text-xs animate-in fade-in zoom-in-95 duration-100">
                      <button
                        onClick={handleExportMarkdown}
                        className="w-full px-3 py-2 text-left text-slate-200 hover:bg-surface-card flex items-center gap-2.5 transition-colors"
                      >
                        <FileText className="w-4 h-4 text-indigo-400 shrink-0" />
                        <div>
                          <div className="font-medium text-slate-200">Markdown 格式 (.md)</div>
                          <div className="text-[10px] text-slate-500">含 AI 纪要与双轨逐字稿</div>
                        </div>
                      </button>
                      <button
                        onClick={handleExportHtml}
                        className="w-full px-3 py-2 text-left text-slate-200 hover:bg-surface-card flex items-center gap-2.5 transition-colors border-t border-surface-border/50"
                      >
                        <Globe className="w-4 h-4 text-emerald-400 shrink-0" />
                        <div>
                          <div className="font-medium text-slate-200">精美 HTML 报告 (.html)</div>
                          <div className="text-[10px] text-slate-500">自包含样式，双击浏览器即开</div>
                        </div>
                      </button>
                      <button
                        onClick={handleExportPdf}
                        className="w-full px-3 py-2 text-left text-slate-200 hover:bg-surface-card flex items-center gap-2.5 transition-colors border-t border-surface-border/50"
                      >
                        <Printer className="w-4 h-4 text-sky-400 shrink-0" />
                        <div>
                          <div className="font-medium text-slate-200">PDF 文档打印 / 另存为</div>
                          <div className="text-[10px] text-slate-500">打印级排版，支持长图归档</div>
                        </div>
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Switch to Floating Pill */}
            <button
              onClick={() => TauriBridge.togglePillWindow()}
              title="切换为置顶悬浮小胶囊"
              className="p-2 rounded-lg bg-surface-card hover:bg-surface-border text-slate-300 border border-surface-border transition-colors text-xs"
            >
              <Minimize2 className="w-4 h-4" />
            </button>

            {/* Record / Stop Button */}
            {recordingState.isRecording ? (
              <button
                onClick={handleStopRecording}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-600/20 transition-all"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
                停止录音并生成纪要
              </button>
            ) : (
              <button
                onClick={handleStartRecording}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/20 transition-all"
              >
                <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                开始录制
              </button>
            )}
          </div>
        </header>

        {/* Dynamic Panels */}
        <div className="flex-1 flex overflow-hidden">
          {/* Transcript Column */}
          {(activeTab === "split" || activeTab === "transcript") && (
            <div
              className={`h-full flex flex-col border-r border-surface-border/80 ${
                activeTab === "split" ? "w-1/2" : "w-full"
              }`}
            >
              <div className="px-4 py-2.5 bg-surface-dark/40 border-b border-surface-border/60 flex items-center justify-between text-xs font-semibold text-slate-400">
                <span className="flex items-center gap-1.5">
                  <MessageSquareText className="w-3.5 h-3.5 text-indigo-400" />
                  双轨分角色实时流
                </span>
                <span className="text-[11px] text-slate-500 font-normal">
                  右侧：【我】 / 左侧：【参会对方】
                </span>
              </div>
              <TranscriptStream
                segments={selectedMeeting?.segments || []}
                isRecording={recordingState.isRecording && recordingState.activeMeetingId === selectedMeeting?.id}
              />
            </div>
          )}

          {/* AI Summary Column */}
          {(activeTab === "split" || activeTab === "summary") && (
            <div className={`h-full flex flex-col bg-surface-darker/50 ${activeTab === "split" ? "w-1/2" : "w-full"}`}>
              <div className="px-4 py-2.5 bg-surface-dark/40 border-b border-surface-border/60 flex items-center justify-between text-xs font-semibold text-slate-400">
                <span className="flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                  AI 会议纪要与待办清单
                </span>
                <span className="text-[11px] text-slate-500 font-normal">
                  符合 PRD 第五节结构约束
                </span>
              </div>
              <div className="flex-1 overflow-hidden">
                <SummaryCard
                  summary={selectedMeeting?.summary || null}
                  isGenerating={isGeneratingSummary}
                  onGenerateSummary={(config) => handleGenerateSummary(undefined, config)}
                  ollamaStatus={ollamaStatus}
                />
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Settings Modal */}
      <SettingsDialog
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        onSave={setSettings}
      />
    </div>
  );
};
