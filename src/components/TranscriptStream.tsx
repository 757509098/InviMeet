import React, { useEffect, useRef } from "react";
import { TranscriptSegment } from "@/types/meeting";
import { Mic, Volume2 } from "lucide-react";

interface TranscriptStreamProps {
  segments: TranscriptSegment[];
  isRecording?: boolean;
}

export const TranscriptStream: React.FC<TranscriptStreamProps> = ({
  segments,
  isRecording = false,
}) => {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [segments.length]);

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

        return (
          <div
            key={seg.id}
            className={`flex flex-col ${isMe ? "items-end" : "items-start"}`}
          >
            {/* Header: Label + Timestamp */}
            <div className="flex items-center gap-1.5 mb-1 px-1 text-xs text-slate-400">
              {isMe ? (
                <>
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
                </>
              )}
            </div>

            {/* Bubble */}
            <div
              className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed shadow-sm ${
                isMe
                  ? "bg-indigo-600 text-white rounded-tr-sm"
                  : "bg-surface-card border border-surface-border/80 text-slate-200 rounded-tl-sm"
              }`}
            >
              {seg.text}
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
