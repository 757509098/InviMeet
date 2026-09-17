import React, { useState } from "react";
import { Meeting } from "@/types/meeting";
import { Plus, Search, Settings, Clock, Sparkles, AudioLines } from "lucide-react";

interface MeetingSidebarProps {
  meetings: Meeting[];
  activeMeetingId: string | null;
  onSelectMeeting: (meeting: Meeting) => void;
  onNewMeeting: () => void;
  onOpenSettings: () => void;
  isRecording?: boolean;
}

export const MeetingSidebar: React.FC<MeetingSidebarProps> = ({
  meetings,
  activeMeetingId,
  onSelectMeeting,
  onNewMeeting,
  onOpenSettings,
  isRecording = false,
}) => {
  const [searchTerm, setSearchTerm] = useState("");

  const filteredMeetings = meetings.filter((m) =>
    m.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    m.tags?.some((t) => t.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const formatDuration = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const s = secs % 60;
    return `${mins}m ${s}s`;
  };

  const formatDate = (isoString: string) => {
    const date = new Date(isoString);
    return `${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  };

  return (
    <aside className="w-80 h-full flex flex-col bg-surface-dark border-r border-surface-border">
      {/* Header */}
      <div className="p-4 border-b border-surface-border flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-indigo-600 to-indigo-400 flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <AudioLines className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-slate-100 tracking-tight">InviMeet</h1>
            <p className="text-[11px] text-slate-400">跨软件双轨会议副驾</p>
          </div>
        </div>

        <button
          onClick={onOpenSettings}
          title="设置"
          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-surface-card transition-colors"
        >
          <Settings className="w-4 h-4" />
        </button>
      </div>

      {/* Action Bar */}
      <div className="p-3 space-y-2">
        <button
          onClick={onNewMeeting}
          disabled={isRecording}
          className={`w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl text-xs font-semibold shadow-sm transition-all ${
            isRecording
              ? "bg-surface-card text-slate-500 cursor-not-allowed"
              : "bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-600/20"
          }`}
        >
          <Plus className="w-4 h-4" />
          新建会议
        </button>

        {/* Search */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="搜索会议主题或标签..."
            className="w-full bg-surface-darker/60 border border-surface-border/70 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"
          />
        </div>
      </div>

      {/* Meeting List */}
      <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-1">
        <div className="px-2 py-1 text-[11px] font-medium text-slate-500 uppercase tracking-wider">
          历史会议 ({filteredMeetings.length})
        </div>

        {filteredMeetings.length === 0 ? (
          <div className="text-center py-8 text-xs text-slate-500">未找到相关会议记录</div>
        ) : (
          filteredMeetings.map((m) => {
            const isActive = m.id === activeMeetingId;
            return (
              <div
                key={m.id}
                onClick={() => onSelectMeeting(m)}
                className={`p-3 rounded-xl border transition-all cursor-pointer ${
                  isActive
                    ? "bg-indigo-600/10 border-indigo-500/30 shadow-sm"
                    : "bg-surface-card/40 hover:bg-surface-card border-transparent hover:border-surface-border"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <h3
                    className={`text-xs font-semibold line-clamp-1 ${
                      isActive ? "text-indigo-400" : "text-slate-200"
                    }`}
                  >
                    {m.title}
                  </h3>
                  {m.summary && (
                    <Sparkles className="w-3 h-3 text-indigo-400 flex-shrink-0" />
                  )}
                </div>

                <div className="flex items-center gap-3 mt-2 text-[11px] text-slate-400">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3 text-slate-500" />
                    {formatDuration(m.durationSeconds)}
                  </span>
                  <span>{formatDate(m.createdAt)}</span>
                </div>

                {m.tags && m.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {m.tags.map((tag, i) => (
                      <span
                        key={i}
                        className="text-[10px] px-1.5 py-0.5 rounded-md bg-surface-darker border border-surface-border text-slate-400"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Footer Info */}
      <div className="p-3 border-t border-surface-border/60 bg-surface-darker/40 flex items-center justify-between text-[11px] text-slate-500">
        <span>Tauri 2.0 Core</span>
        <span className="inline-flex items-center gap-1 text-emerald-400">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          双轨引擎就绪
        </span>
      </div>
    </aside>
  );
};
