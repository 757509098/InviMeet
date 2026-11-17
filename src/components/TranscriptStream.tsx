import React, { useEffect, useRef } from "react";
import { TranscriptSegment } from "@/types/meeting";
import { Mic, Volume2, Play, Pause } from "lucide-react";

interface TranscriptStreamProps {
  segments: TranscriptSegment[];
  isRecording?: boolean;
  activeSegmentId?: string | null;
  isPlaying?: boolean;
  onPlaySegment?: (segment: TranscriptSegment) => void;
}

export const TranscriptStream: React.FC<TranscriptStreamProps> = ({
  segments,
  isRecording = false,
  activeSegmentId = null,
  isPlaying = false,
  onPlaySegment,
}) => {
  const bottomRef = useRef<HTMLDivElement>(null);
  const activeBubbleRef = useRef<HTMLDivElement>(null);

  // Auto-scroll on new transcript during recording
  useEffect(() => {
    if (isRecording) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [segments.length, isRecording]);

  // Scroll to active segment when playing
  useEffect(() => {
    if (activeSegmentId && activeBubbleRef.current) {
      activeBubbleRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [activeSegmentId]);

  const formatTime = (ms: number) => {
    const totalSecs = Math.floor(ms / 1000);
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  };

  if (segments.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-slate-500 p-8">
        <div className="w-12 h-12 rounded-full bg-surface-card border border-surface-border flex items-center justify-center mb-3">
          <Mic className="w-5 h-5 text-indigo-400 opacity-60" />
        </div>
        <p className="text-sm font-medium">暂无对话记录</p>
        <p className="text-xs text-slate-600 mt-1">
          {isRecording ? "正在监听双轨音频并实时转录中..." : "点击右上角“开始录制”即刻体验双轨分流转录"}
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {segments.map((seg) => {
        const isMe = seg.speaker === "me";
        const isActive = activeSegmentId === seg.id;
        const isCurrentlyPlaying = isActive && isPlaying;

        return (
          <div
            key={seg.id}
            ref={isActive ? activeBubbleRef : undefined}
            className={`flex flex-col group ${isMe ? "items-end" : "items-start"}`}
          >
            {/* Header: Label + Timestamp + Play Action */}
            <div className="flex items-center gap-2 mb-1 px-1 text-xs text-slate-400">
              {isMe ? (
                <>
                  {/* Play Button Trigger */}
                  <button
                    onClick={() => onPlaySegment?.(seg)}
                    title={isCurrentlyPlaying ? "暂停当前录音" : "播放该句对应音频"}
                    className={`flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded transition-all ${
                      isActive
                        ? "text-indigo-300 bg-indigo-500/20 font-medium"
                        : "opacity-0 group-hover:opacity-100 hover:bg-surface-card text-slate-400 hover:text-indigo-300"
                    }`}
                  >
                    {isCurrentlyPlaying ? (
                      <>
                        <Pause className="w-3 h-3 fill-current" />
                        <span>暂停</span>
                      </>
                    ) : (
                      <>
                        <Play className="w-3 h-3 fill-current" />
                        <span>播放原声</span>
                      </>
                    )}
                  </button>

                  <span className="text-[11px] text-slate-500">{formatTime(seg.timestampMs)}</span>
                  <span className="font-medium text-indigo-400 flex items-center gap-1">
                    {seg.speakerLabel || "我"}
                    <Mic className="w-3 h-3" />
                  </span>
                </>
              ) : (
                <>
                  <span className="font-medium text-emerald-400 flex items-center gap-1">
                    <Volume2 className="w-3 h-3" />
                    {seg.speakerLabel || "参会对方"}
                  </span>
                  <span className="text-[11px] text-slate-500">{formatTime(seg.timestampMs)}</span>

                  {/* Play Button Trigger */}
                  <button
                    onClick={() => onPlaySegment?.(seg)}
                    title={isCurrentlyPlaying ? "暂停当前录音" : "播放该句对应音频"}
                    className={`flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded transition-all ${
                      isActive
                        ? "text-emerald-300 bg-emerald-500/20 font-medium"
                        : "opacity-0 group-hover:opacity-100 hover:bg-surface-card text-slate-400 hover:text-emerald-300"
                    }`}
                  >
                    {isCurrentlyPlaying ? (
                      <>
                        <Pause className="w-3 h-3 fill-current" />
                        <span>暂停</span>
                      </>
                    ) : (
                      <>
                        <Play className="w-3 h-3 fill-current" />
                        <span>播放原声</span>
                      </>
                    )}
                  </button>
                </>
              )}
            </div>

            {/* Bubble */}
            <div
              onClick={() => onPlaySegment?.(seg)}
              title="点击播放本句录音"
              className={`max-w-[82%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed shadow-sm cursor-pointer transition-all duration-200 relative select-text ${
                isMe
                  ? "bg-indigo-600 text-white rounded-tr-sm hover:brightness-105"
                  : "bg-surface-card border border-surface-border/80 text-slate-200 rounded-tl-sm hover:border-surface-border"
              } ${
                isActive
                  ? isMe
                    ? "ring-2 ring-white/60 shadow-lg shadow-indigo-600/30 brightness-110"
                    : "ring-2 ring-emerald-400/80 shadow-lg shadow-emerald-500/20 border-emerald-500/50"
                  : ""
              }`}
            >
              {seg.text}

              {/* Live Playing Wave Indicator */}
              {isCurrentlyPlaying && (
                <div
                  className={`inline-flex items-center gap-0.5 ml-2 align-middle ${
                    isMe ? "text-indigo-200" : "text-emerald-400"
                  }`}
                >
                  <span className="w-1 h-3 bg-current rounded-full animate-pulse" />
                  <span className="w-1 h-4 bg-current rounded-full animate-pulse delay-75" />
                  <span className="w-1 h-2 bg-current rounded-full animate-pulse delay-150" />
                </div>
              )}
            </div>
          </div>
        );
      })}

      {isRecording && (
        <div className="flex items-center gap-2 text-xs text-indigo-400/80 px-2 py-1">
          <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
          <span>正在转录实时语音...</span>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
};

