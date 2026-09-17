import React, { useState, useEffect } from "react";
import { TauriBridge } from "@/lib/tauriBridge";
import { RecordingState } from "@/types/meeting";
import { AudioWaveform } from "@/components/AudioWaveform";
import { Square, Play, LayoutDashboard, GripVertical } from "lucide-react";

export const PillWindow: React.FC = () => {
  const [recordingState, setRecordingState] = useState<RecordingState>({
    isRecording: false,
    isPaused: false,
    durationSeconds: 0,
    activeMeetingId: null,
    micLevel: 0,
    speakerLevel: 0,
  });

  useEffect(() => {
    let isMounted = true;
    let unlistenFns: Array<() => void> = [];

    // Initial fetch
    TauriBridge.getRecordingState()
      .then((s) => {
        if (isMounted && s) setRecordingState(s);
      })
      .catch(() => {});

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

  const handleToggleRecord = async () => {
    try {
      if (recordingState.isRecording) {
        setRecordingState((prev) => ({
          ...prev,
          isRecording: false,
          micLevel: 0,
          speakerLevel: 0,
        }));
        await TauriBridge.stopRecording();
      } else {
        setRecordingState((prev) => ({
          ...prev,
          isRecording: true,
          durationSeconds: 0,
          micLevel: 0,
          speakerLevel: 0,
        }));
        await TauriBridge.startRecording("快速录制会议");
      }
    } catch (err) {
      console.error("Failed to toggle recording in pill window:", err);
    }
  };

  const handleOpenDashboard = () => {
    TauriBridge.openMainWindow();
  };

  const formatTimer = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };

  return (
    <div
      data-tauri-drag-region
      className="w-full h-full select-none bg-surface-dark/90 backdrop-blur-md border border-surface-border/80 text-slate-100 rounded-full px-3 py-1.5 flex items-center justify-between shadow-2xl overflow-hidden cursor-move transition-all"
    >
      {/* Left: Drag grip & Status indicator */}
      <div className="flex items-center gap-1.5" data-tauri-drag-region>
        <GripVertical className="w-3.5 h-3.5 text-slate-500 opacity-60" />
        <span
          className={`w-2.5 h-2.5 rounded-full transition-all ${
            recordingState.isRecording
              ? "bg-rose-500 shadow-lg shadow-rose-500/50 animate-pulse-fast"
              : "bg-slate-500"
          }`}
        />
        <span className="text-xs font-mono font-medium text-slate-300 w-11">
          {formatTimer(recordingState.durationSeconds)}
        </span>
      </div>

      {/* Center: Real-time Waveform */}
      <div className="flex-1 flex justify-center px-2" data-tauri-drag-region>
        <AudioWaveform
          micLevel={recordingState.micLevel}
          speakerLevel={recordingState.speakerLevel}
          compact
        />
      </div>

      {/* Right: Record/Stop Button & Open Dashboard */}
      <div className="flex items-center gap-1.5" data-no-drag>
        <button
          onClick={handleToggleRecord}
          title={recordingState.isRecording ? "停止录音并生成纪要" : "开始录制"}
          className={`w-7 h-7 rounded-full flex items-center justify-center transition-all ${
            recordingState.isRecording
              ? "bg-rose-500/20 text-rose-400 hover:bg-rose-500 hover:text-white"
              : "bg-indigo-600 text-white hover:bg-indigo-500 shadow-sm"
          }`}
        >
          {recordingState.isRecording ? (
            <Square className="w-3 h-3 fill-current" />
          ) : (
            <Play className="w-3 h-3 fill-current ml-0.5" />
          )}
        </button>

        <button
          onClick={handleOpenDashboard}
          title="展开主工作台"
          className="w-7 h-7 rounded-full bg-surface-card hover:bg-surface-border text-slate-300 flex items-center justify-center transition-colors"
        >
          <LayoutDashboard className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
