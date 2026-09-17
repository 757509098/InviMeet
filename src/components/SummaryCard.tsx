import React, { useState } from "react";
import { MeetingSummary, LlmConfig, OllamaStatus } from "@/types/meeting";
import { Sparkles, CheckCircle2, Circle, Copy, Check, Calendar, User, Cpu } from "lucide-react";

interface SummaryCardProps {
  summary: MeetingSummary | null;
  isGenerating?: boolean;
  onGenerateSummary?: (config?: LlmConfig) => void;
  ollamaStatus?: OllamaStatus | null;
}

const LLM_OPTIONS: { id: string; provider: "ollama" | "deepseek"; name: string; tag: string }[] = [
  { id: "qwen2.5:7b", provider: "ollama", name: "Qwen-2.5-7B", tag: "本地离线·快速" },
  { id: "qwen2.5:14b", provider: "ollama", name: "Qwen-2.5-14B", tag: "本地离线·高精" },
  { id: "deepseek-chat", provider: "deepseek", name: "DeepSeek-V3", tag: "云端商业模型" },
];

export const SummaryCard: React.FC<SummaryCardProps> = ({
  summary,
  isGenerating = false,
  onGenerateSummary,
  ollamaStatus,
}) => {
  const [copied, setCopied] = useState(false);
  const [actionItems, setActionItems] = useState(summary?.action_items || []);
  const [selectedModel, setSelectedModel] = useState<string>("qwen2.5:7b");

  // Sync state if summary changes
  React.useEffect(() => {
    if (summary?.action_items) {
      setActionItems(summary.action_items);
    }
  }, [summary]);

  const handleToggleItem = (index: number) => {
    setActionItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, completed: !item.completed } : item))
    );
  };

  const handleTriggerGenerate = () => {
    if (!onGenerateSummary) return;
    const opt = LLM_OPTIONS.find((o) => o.id === selectedModel) || LLM_OPTIONS[0];
    onGenerateSummary({
      provider: opt.provider,
      model: opt.id,
    });
  };

  const handleCopyMarkdown = () => {
    if (!summary) return;

    let text = `# ${summary.title}\n\n`;
    text += `### 核心摘要\n${summary.summary}\n\n`;
    text += `### 讨论议题与共识\n`;
    summary.topics.forEach((t, i) => {
      text += `#### ${i + 1}. ${t.name}\n- **共识**：${t.consensus}\n`;
      t.key_points.forEach((p) => (text += `  - ${p}\n`));
    });
    text += `\n### 待办清单 (Action Items)\n`;
    actionItems.forEach((item) => {
      text += `- [${item.completed ? "x" : " "}] @${item.owner}: ${item.task} (截止: ${item.due_date})\n`;
    });

    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (isGenerating) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8 text-center">
        <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center mb-4">
          <Sparkles className="w-6 h-6 text-indigo-400 animate-spin" />
        </div>
        <h4 className="text-sm font-semibold text-slate-200">
          {LLM_OPTIONS.find((m) => m.id === selectedModel)?.name || "AI"} 正在深度提炼会议纪要...
        </h4>
        <p className="text-xs text-slate-500 mt-1 max-w-xs">
          过滤语气助词、提取关键议题决议并整理待办事项清单
        </p>
      </div>
    );
  }

  if (!summary) {
    const isLocalOllama = selectedModel.startsWith("qwen");

    return (
      <div className="h-full flex flex-col items-center justify-center p-8 text-center">
        <div className="w-12 h-12 rounded-2xl bg-surface-card border border-surface-border flex items-center justify-center mb-4">
          <Sparkles className="w-6 h-6 text-indigo-400" />
        </div>
        <h4 className="text-sm font-semibold text-slate-300">尚未生成 AI 纪要</h4>
        <p className="text-xs text-slate-500 mt-1 max-w-xs mb-4">
          由大语言模型自动为您生成结构化会议主题、议题共识及行动待办清单。
        </p>

        {/* Model Selector Card */}
        <div className="w-full max-w-xs bg-surface-card/70 border border-surface-border rounded-xl p-3 mb-4 space-y-2 text-left">
          <label className="text-[11px] font-semibold text-slate-400 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <Cpu className="w-3.5 h-3.5 text-indigo-400" />
              提炼模型 (可自由切换)
            </span>
            {isLocalOllama && (
              <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                {ollamaStatus?.isRunning ? "Ollama 就绪" : "Ollama 离线"}
              </span>
            )}
          </label>
          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            className="w-full bg-surface-dark border border-surface-border rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
          >
            {LLM_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.name} ({opt.tag})
              </option>
            ))}
          </select>
          {isLocalOllama && !ollamaStatus?.isRunning && (
            <p className="text-[10px] text-slate-500">
              💡 终端运行 <code className="text-indigo-300 bg-surface-dark px-1 rounded">ollama run {selectedModel}</code> 即刻开启本地完全离线推理。
            </p>
          )}
        </div>

        {onGenerateSummary && (
          <button
            onClick={handleTriggerGenerate}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-medium transition-colors shadow-sm"
          >
            <Sparkles className="w-3.5 h-3.5" />
            一键生成 AI 会议纪要
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-5 space-y-6">
      {/* Top Header */}
      <div className="flex items-start justify-between gap-4 pb-4 border-b border-surface-border/80">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              <Sparkles className="w-3 h-3" />
              AI 智能结构化提炼
            </span>

            {/* Quick Model Selector Dropdown */}
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="bg-surface-card border border-surface-border text-slate-300 text-[11px] rounded-lg px-2 py-0.5 focus:outline-none focus:border-indigo-500"
            >
              {LLM_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.name}
                </option>
              ))}
            </select>
          </div>
          <h2 className="text-lg font-bold text-slate-100">{summary.title}</h2>
        </div>

        <div className="flex items-center gap-2">
          {onGenerateSummary && (
            <button
              onClick={handleTriggerGenerate}
              title="切换模型重新生成"
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-slate-300 hover:text-white bg-surface-card hover:bg-surface-border border border-surface-border transition-colors text-xs"
            >
              <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
              重新提炼
            </button>
          )}
          <button
            onClick={handleCopyMarkdown}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-surface-card hover:bg-surface-border border border-surface-border text-slate-200 transition-colors"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? "已复制" : "复制 Markdown"}
          </button>
        </div>
      </div>

      {/* Summary Box */}
      <div className="bg-surface-card/70 border border-surface-border/70 rounded-xl p-4">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
          核心背景与结论
        </h3>
        <p className="text-sm text-slate-300 leading-relaxed">{summary.summary}</p>
      </div>

      {/* Topics & Consensus */}
      <div className="space-y-3">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
          讨论议题与核心共识 ({summary.topics.length})
        </h3>
        <div className="space-y-3">
          {summary.topics.map((topic, idx) => (
            <div
              key={idx}
              className="bg-surface-card/40 border border-surface-border/60 rounded-xl p-3.5 space-y-2"
            >
              <h4 className="text-sm font-semibold text-indigo-300 flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-indigo-500/20 text-indigo-400 text-xs flex items-center justify-center font-bold">
                  {idx + 1}
                </span>
                {topic.name}
              </h4>
              <div className="pl-7 text-xs text-emerald-300/90 font-medium bg-emerald-500/5 p-2 rounded-lg border border-emerald-500/10">
                <span className="text-emerald-400 font-bold">共识：</span> {topic.consensus}
              </div>
              <ul className="pl-7 space-y-1">
                {topic.key_points.map((point, pIdx) => (
                  <li key={pIdx} className="text-xs text-slate-400 list-disc list-inside">
                    {point}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      {/* Action Items */}
      <div className="space-y-3">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
          待办清单 Action Items ({actionItems.length})
        </h3>
        <div className="space-y-2">
          {actionItems.map((item, idx) => (
            <div
              key={idx}
              onClick={() => handleToggleItem(idx)}
              className={`flex items-start gap-3 p-3 rounded-xl border transition-all cursor-pointer ${
                item.completed
                  ? "bg-surface-darker/40 border-surface-border/40 opacity-60"
                  : "bg-surface-card/60 border-surface-border/80 hover:border-indigo-500/40"
              }`}
            >
              <button className="mt-0.5 text-slate-400 hover:text-indigo-400 transition-colors">
                {item.completed ? (
                  <CheckCircle2 className="w-4 h-4 text-indigo-400" />
                ) : (
                  <Circle className="w-4 h-4 text-slate-500" />
                )}
              </button>

              <div className="flex-1 min-w-0">
                <p
                  className={`text-sm ${
                    item.completed ? "line-through text-slate-500" : "text-slate-200"
                  }`}
                >
                  {item.task}
                </p>
                <div className="flex items-center gap-3 mt-1.5 text-xs text-slate-400">
                  <span className="inline-flex items-center gap-1 text-indigo-400">
                    <User className="w-3 h-3" />
                    {item.owner}
                  </span>
                  <span className="inline-flex items-center gap-1 text-slate-500">
                    <Calendar className="w-3 h-3" />
                    {item.due_date}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
