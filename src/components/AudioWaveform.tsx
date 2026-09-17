import React from "react";

interface AudioWaveformProps {
  micLevel: number;     // 0.0 - 1.0
  speakerLevel: number; // 0.0 - 1.0
  compact?: boolean;
}

export const AudioWaveform: React.FC<AudioWaveformProps> = ({
  micLevel,
  speakerLevel,
  compact = false,
}) => {
  // Balanced multipliers for dynamic equalizer waveform wave
  const micBars = [0.35, 0.7, 1.0, 0.85, 0.6, 0.4];
  const speakerBars = [0.4, 0.75, 1.0, 0.8, 0.55, 0.35];

  // Speech active thresholds
  const isMicActive = micLevel > 0.02;
  const isSpeakerActive = speakerLevel > 0.02;

  if (compact) {
    return (
      <div className="flex items-center gap-2">
        {/* Mic Indicator (Compact) */}
        <div className="flex items-center gap-0.5 h-4 px-1 py-0.5 bg-indigo-950/40 rounded-md border border-indigo-500/20">
          <span className="w-1.5 h-1.5 rounded-full mr-0.5 bg-indigo-400" />
          {micBars.map((multiplier, idx) => {
            // Pixel height between 3px and 14px
            const levelScale = Math.min(1.0, Math.pow(Math.max(0, micLevel), 0.6) * 1.5);
            const heightPx = Math.max(3, Math.min(14, Math.round(3 + levelScale * multiplier * 11)));
            return (
              <span
                key={`mic-compact-${idx}`}
                className={`w-1 rounded-full transition-all duration-75 inline-block ${
                  isMicActive ? "bg-indigo-400 shadow-[0_0_6px_rgba(99,102,241,0.8)]" : "bg-indigo-500/40"
                }`}
                style={{ height: `${heightPx}px` }}
              />
            );
          })}
        </div>

        {/* Speaker Indicator (Compact) */}
        <div className="flex items-center gap-0.5 h-4 px-1 py-0.5 bg-emerald-950/40 rounded-md border border-emerald-500/20">
          <span className="w-1.5 h-1.5 rounded-full mr-0.5 bg-emerald-400" />
          {speakerBars.map((multiplier, idx) => {
            const levelScale = Math.min(1.0, Math.pow(Math.max(0, speakerLevel), 0.6) * 1.5);
            const heightPx = Math.max(3, Math.min(14, Math.round(3 + levelScale * multiplier * 11)));
            return (
              <span
                key={`spk-compact-${idx}`}
                className={`w-1 rounded-full transition-all duration-75 inline-block ${
                  isSpeakerActive ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]" : "bg-emerald-500/40"
                }`}
                style={{ height: `${heightPx}px` }}
              />
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 bg-surface-card/80 border border-surface-border rounded-xl px-3.5 py-1.5 shadow-sm">
      {/* Mic Channel (Me) */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5">
          <span
            className={`w-2 h-2 rounded-full transition-all ${
              isMicActive
                ? "bg-indigo-400 shadow-[0_0_8px_rgba(129,140,248,0.9)] animate-pulse"
                : "bg-indigo-500/50"
            }`}
          />
          <span className="text-xs text-indigo-300 font-medium">麦克风</span>
        </div>
        <div className="flex items-center gap-0.5 h-5 w-16 justify-center">
          {micBars.map((multiplier, idx) => {
            // Pixel height between 4px and 20px
            const levelScale = Math.min(1.0, Math.pow(Math.max(0, micLevel), 0.55) * 1.6);
            const heightPx = Math.max(4, Math.min(20, Math.round(4 + levelScale * multiplier * 16)));
            return (
              <span
                key={`mic-lg-${idx}`}
                className={`w-1.5 rounded-full transition-all duration-75 inline-block ${
                  isMicActive
                    ? "bg-indigo-400 shadow-[0_0_8px_rgba(129,140,248,0.7)]"
                    : "bg-indigo-900/60"
                }`}
                style={{ height: `${heightPx}px` }}
              />
            );
          })}
        </div>
      </div>

      <div className="w-px h-4 bg-surface-border" />

      {/* Speaker Channel (Remote) */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5">
          <span
            className={`w-2 h-2 rounded-full transition-all ${
              isSpeakerActive
                ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)] animate-pulse"
                : "bg-emerald-500/50"
            }`}
          />
          <span className="text-xs text-emerald-300 font-medium">对方扬声器</span>
        </div>
        <div className="flex items-center gap-0.5 h-5 w-16 justify-center">
          {speakerBars.map((multiplier, idx) => {
            const levelScale = Math.min(1.0, Math.pow(Math.max(0, speakerLevel), 0.55) * 1.6);
            const heightPx = Math.max(4, Math.min(20, Math.round(4 + levelScale * multiplier * 16)));
            return (
              <span
                key={`spk-lg-${idx}`}
                className={`w-1.5 rounded-full transition-all duration-75 inline-block ${
                  isSpeakerActive
                    ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)]"
                    : "bg-emerald-900/60"
                }`}
                style={{ height: `${heightPx}px` }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
};
