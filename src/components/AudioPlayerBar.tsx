import React from "react";
import { SpeakerRole } from "@/types/meeting";
import {
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  Volume2,
  Mic,
  X,
} from "lucide-react";

interface AudioPlayerBarProps {
  isPlaying: boolean;
  currentTimeMs: number;
  durationMs: number;
  currentTrack: SpeakerRole;
  playbackRate: number;
  activeSegmentText?: string;
  onPlayPause: () => void;
  onSeek: (timeMs: number) => void;
  onSkip: (offsetSec: number) => void;
  onRateChange: (rate: number) => void;
  onTrackChange: (track: SpeakerRole) => void;
  onClose: () => void;
}

const SPEED_OPTIONS = [1.0, 1.25, 1.5, 2.0];

export const AudioPlayerBar: React.FC<AudioPlayerBarProps> = ({
  isPlaying,
  currentTimeMs,
  durationMs,
  currentTrack,
  playbackRate,
  activeSegmentText,
  onPlayPause,
  onSeek,
  onSkip,
  onRateChange,
  onTrackChange,
  onClose,
}) => {
  const formatTime = (ms: number) => {
    const totalSecs = Math.max(0, Math.floor(ms / 1000));
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  };

  const progressPercent = durationMs > 0 ? Math.min(100, (currentTimeMs / durationMs) * 100) : 0;

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    onSeek((val / 100) * durationMs);
  };

  return (
    <div className="mx-3 mb-3 bg-surface-dark/95 border border-surface-border/90 rounded-2xl shadow-2xl backdrop-blur-md p-3 flex flex-col gap-2.5 transition-all animate-in fade-in slide-in-from-bottom-2 duration-200">
      {/* Top row: Current segment preview snippet & Close button */}
      <div className="flex items-center justify-between gap-3 px-1 text-xs">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div className="flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border border-surface-border bg-surface-card shrink-0">
            {currentTrack === "me" ? (
              <span className="text-indigo-400 flex items-center gap-1">
                <Mic className="w-3 h-3" /> 我方麦克风轨
              </span>
            ) : (
              <span className="text-emerald-400 flex items-center gap-1">
                <Volume2 className="w-3 h-3" /> 对方扬声器轨
              </span>
            )}
          </div>
          {activeSegmentText ? (
            <span className="truncate text-slate-300 text-[12px] font-normal" title={activeSegmentText}>
              "{activeSegmentText}"
            </span>
          ) : (
            <span className="text-slate-500 text-[11px]">点击对话气泡可定点跳转播放</span>
          )}
        </div>

        {/* Close player button */}
        <button
          onClick={onClose}
          title="关闭播放器"
          className="text-slate-400 hover:text-slate-200 p-1 rounded-md hover:bg-surface-border/50 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Middle row: Seek progress slider & Time indicators */}
      <div className="flex items-center gap-2.5 px-1">
        <span className="text-[11px] font-mono text-indigo-300 w-11 text-right shrink-0">
          {formatTime(currentTimeMs)}
        </span>
        <div className="relative flex-1 flex items-center group">
          <input
            type="range"
            min={0}
            max={100}
            step={0.1}
            value={isNaN(progressPercent) ? 0 : progressPercent}
            onChange={handleSliderChange}
            className="w-full h-1.5 bg-surface-border/80 rounded-lg appearance-none cursor-pointer accent-indigo-500 hover:accent-indigo-400 focus:outline-none transition-all"
          />
        </div>
        <span className="text-[11px] font-mono text-slate-400 w-11 shrink-0">
          {formatTime(durationMs)}
        </span>
      </div>

      {/* Bottom row: Playback buttons, Speed, and Track switch */}
      <div className="flex items-center justify-between px-1">
        {/* Left: Track Switcher */}
        <div className="flex items-center gap-1 bg-surface-card/60 p-0.5 rounded-lg border border-surface-border/50">
          <button
            onClick={() => onTrackChange("me")}
            title="切换到我方麦克风音轨"
            className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
              currentTrack === "me"
                ? "bg-indigo-600 text-white shadow-sm"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <Mic className="w-3 h-3" /> 我方
          </button>
          <button
            onClick={() => onTrackChange("remote")}
            title="切换到对方扬声器音轨"
            className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
              currentTrack === "remote"
                ? "bg-emerald-600 text-white shadow-sm"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <Volume2 className="w-3 h-3" /> 对方
          </button>
        </div>

        {/* Center: Play, Pause, Rewind, FastForward */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => onSkip(-5)}
            title="快退 5 秒"
            className="p-1.5 rounded-full text-slate-400 hover:text-slate-200 hover:bg-surface-card transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={onPlayPause}
            title={isPlaying ? "暂停播放" : "继续播放"}
            className="w-8 h-8 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white flex items-center justify-center shadow-md shadow-indigo-600/30 transition-transform active:scale-95"
          >
            {isPlaying ? (
              <Pause className="w-4 h-4 fill-current" />
            ) : (
              <Play className="w-4 h-4 fill-current ml-0.5" />
            )}
          </button>

          <button
            onClick={() => onSkip(5)}
            title="快进 5 秒"
            className="p-1.5 rounded-full text-slate-400 hover:text-slate-200 hover:bg-surface-card transition-colors"
          >
            <RotateCw className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Right: Playback Speed Toggle */}
        <div className="flex items-center gap-1">
          <div className="flex items-center gap-0.5 bg-surface-card/60 p-0.5 rounded-lg border border-surface-border/50">
            {SPEED_OPTIONS.map((rate) => (
              <button
                key={rate}
                onClick={() => onRateChange(rate)}
                className={`px-1.5 py-0.5 rounded text-[11px] font-medium transition-colors ${
                  playbackRate === rate
                    ? "bg-indigo-500/20 text-indigo-300 font-semibold"
                    : "text-slate-500 hover:text-slate-300"
                }`}
              >
                {rate}x
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
