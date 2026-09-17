import React, { useState, useEffect } from "react";
import { AppSettings, AudioDeviceInfo, AsrModelStatus, ModelDownloadProgress, OllamaStatus } from "@/types/meeting";
import { TauriBridge, AudioPermissionsState } from "@/lib/tauriBridge";
import {
  X,
  Mic,
  Volume2,
  Cpu,
  Key,
  Check,
  ShieldCheck,
  AlertTriangle,
  ExternalLink,
  Download,
  CheckCircle2,
  HardDrive,
  Loader2,
  Server,
} from "lucide-react";

interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppSettings;
  onSave: (settings: AppSettings) => void;
}

export const SettingsDialog: React.FC<SettingsDialogProps> = ({
  isOpen,
  onClose,
  settings: initialSettings,
  onSave,
}) => {
  const [form, setForm] = useState<AppSettings>(initialSettings);
  const [devices, setDevices] = useState<AudioDeviceInfo[]>([]);
  const [permissionState, setPermissionState] = useState<AudioPermissionsState>({
    hasScreenCapturePermission: true,
    platform: "unknown",
  });
  const [isRequestingPermission, setIsRequestingPermission] = useState(false);
  const [activeTab, setActiveTab] = useState<"audio" | "ai">("audio");
  const [modelStatus, setModelStatus] = useState<AsrModelStatus | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<ModelDownloadProgress | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus | null>(null);

  useEffect(() => {
    if (isOpen) {
      setForm(initialSettings);
      TauriBridge.getAudioDevices().then(setDevices);
      TauriBridge.checkAudioPermissions().then(setPermissionState);
      TauriBridge.checkAsrModelStatus().then(setModelStatus);
      TauriBridge.checkOllamaStatus().then(setOllamaStatus).catch(() => {});
    }
  }, [isOpen, initialSettings]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    TauriBridge.onEvent<ModelDownloadProgress>("asr-model-download-progress", (p) => {
      setDownloadProgress(p);
      if (p.isCompleted) {
        setIsDownloading(false);
        setDownloadError(null);
        TauriBridge.checkAsrModelStatus().then(setModelStatus);
      }
      if (p.error) {
        setIsDownloading(false);
        setDownloadError(p.error);
      }
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  const handleDownloadModel = async () => {
    setIsDownloading(true);
    setDownloadError(null);
    try {
      await TauriBridge.downloadAsrModel();
      setIsDownloading(false);
      const status = await TauriBridge.checkAsrModelStatus();
      setModelStatus(status);
    } catch (err: any) {
      console.error("Model download failed:", err);
      setIsDownloading(false);
      setDownloadError(err?.message || String(err));
    }
  };

  const handleRequestPermission = async () => {
    setIsRequestingPermission(true);
    try {
      await TauriBridge.requestAudioPermissions();
      // Wait for macOS permission dialog interaction
      setTimeout(async () => {
        const p = await TauriBridge.checkAudioPermissions();
        setPermissionState(p);
        setIsRequestingPermission(false);
      }, 1500);
    } catch {
      setIsRequestingPermission(false);
    }
  };

  if (!isOpen) return null;

  const micDevices = devices.filter((d) => d.kind === "input");
  const speakerDevices = devices.filter((d) => d.kind === "output");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg bg-surface-dark border border-surface-border rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Modal Header */}
        <div className="p-4 border-b border-surface-border flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-100">InviMeet 系统偏好设置</h2>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-surface-card"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-surface-border bg-surface-darker/50 px-4">
          <button
            onClick={() => setActiveTab("audio")}
            className={`flex items-center gap-2 py-3 px-3 text-xs font-semibold border-b-2 transition-colors ${
              activeTab === "audio"
                ? "border-indigo-500 text-indigo-400"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            <Mic className="w-3.5 h-3.5" />
            底层双轨音频
          </button>
          <button
            onClick={() => setActiveTab("ai")}
            className={`flex items-center gap-2 py-3 px-3 text-xs font-semibold border-b-2 transition-colors ${
              activeTab === "ai"
                ? "border-indigo-500 text-indigo-400"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            <Cpu className="w-3.5 h-3.5" />
            ASR 与 AI 引擎
          </button>
        </div>

        {/* Tab Body */}
        <div className="p-5 flex-1 overflow-y-auto space-y-5">
          {activeTab === "audio" ? (
            <>
              {/* Mic Select */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                  <Mic className="w-3.5 h-3.5 text-indigo-400" />
                  麦克风设备 (捕获【我】的声音)
                </label>
                <select
                  value={form.selectedMicDevice}
                  onChange={(e) => setForm({ ...form, selectedMicDevice: e.target.value })}
                  className="w-full bg-surface-card border border-surface-border rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                >
                  <option value="default">默认系统麦克风 (推荐)</option>
                  {micDevices.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-slate-500">
                  支持声卡/蓝牙耳机热插拔自愈，重采样统一为 16kHz 单声道。
                </p>
              </div>

              {/* Speaker Loopback Select */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                  <Volume2 className="w-3.5 h-3.5 text-emerald-400" />
                  扬声器环回设备 (捕获【参会对方】的声音)
                </label>
                <select
                  value={form.selectedSpeakerDevice}
                  onChange={(e) => setForm({ ...form, selectedSpeakerDevice: e.target.value })}
                  className="w-full bg-surface-card border border-surface-border rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                >
                  <option value="default">系统默认扬声器 (WASAPI / SCKit 原生截流)</option>
                  {speakerDevices.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-slate-500">
                  基于 Windows WASAPI Loopback 或 macOS ScreenCaptureKit，免驱动免安装虚拟声卡。
                </p>
              </div>

              {/* Permission Banner */}
              {permissionState.platform === "macos" && (
                <div
                  className={`p-3 rounded-xl border flex items-start gap-2.5 transition-colors ${
                    permissionState.hasScreenCapturePermission
                      ? "bg-emerald-950/20 border-emerald-500/30 text-emerald-300"
                      : "bg-amber-950/25 border-amber-500/40 text-amber-300"
                  }`}
                >
                  {permissionState.hasScreenCapturePermission ? (
                    <ShieldCheck className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
                  )}
                  <div className="flex-1 text-xs">
                    <div className="font-semibold">
                      {permissionState.hasScreenCapturePermission
                        ? "macOS 系统音频录制权限正常"
                        : "需要系统音频与屏幕录制权限"}
                    </div>
                    <p className="text-[11px] mt-0.5 opacity-80 leading-relaxed">
                      {permissionState.hasScreenCapturePermission
                        ? "已通过 ScreenCaptureKit 原生接入扬声器输出，会议中可实时捕获对方声音。"
                        : "macOS 13+ 需要在系统隐私设置中为 InviMeet 开启「屏幕与系统音频录制」权限，方可免声卡捕获扬声器声音。"}
                    </p>
                    {!permissionState.hasScreenCapturePermission && (
                      <button
                        type="button"
                        onClick={handleRequestPermission}
                        disabled={isRequestingPermission}
                        className="mt-2 inline-flex items-center gap-1.5 px-3 py-1 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 rounded-lg text-amber-200 text-[11px] font-medium transition-all"
                      >
                        <ExternalLink className="w-3 h-3" />
                        {isRequestingPermission ? "正在检查权限..." : "请求系统授权 / 重新检测"}
                      </button>
                    )}
                  </div>
                </div>
              )}

              {permissionState.platform === "windows" && (
                <div className="p-3 rounded-xl border bg-indigo-950/20 border-indigo-500/30 text-indigo-300 flex items-start gap-2.5">
                  <ShieldCheck className="w-4 h-4 text-indigo-400 mt-0.5 shrink-0" />
                  <div className="flex-1 text-xs">
                    <div className="font-semibold">Windows WASAPI 硬件环回就绪</div>
                    <p className="text-[11px] mt-0.5 opacity-80 leading-relaxed">
                      已启用 Windows 内核 WASAPI Loopback，免驱动免安装任何第三方软件，自动混音转采样 16kHz。
                    </p>
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              {/* ASR Mode */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-slate-300">语音转文字 (ASR) 引擎模式</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, asrMode: "local" })}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      form.asrMode === "local"
                        ? "bg-indigo-600/15 border-indigo-500 text-indigo-300"
                        : "bg-surface-card/60 border-surface-border text-slate-400"
                    }`}
                  >
                    <div className="text-xs font-bold flex items-center gap-1.5">
                      <HardDrive className="w-3.5 h-3.5 text-indigo-400" />
                      端侧离线 (SenseVoice-Small)
                    </div>
                    <div className="text-[10px] mt-1 opacity-70">
                      阿里开源，RTF &lt; 0.04 极速推理，中英混杂极佳
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setForm({ ...form, asrMode: "cloud" })}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      form.asrMode === "cloud"
                        ? "bg-indigo-600/15 border-indigo-500 text-indigo-300"
                        : "bg-surface-card/60 border-surface-border text-slate-400"
                    }`}
                  >
                    <div className="text-xs font-bold">云端/演练模式</div>
                    <div className="text-[10px] mt-1 opacity-70">支持 WebSocket 流式或模拟转录</div>
                  </button>
                </div>

                {/* SenseVoice-Small Model Status Card */}
                {form.asrMode === "local" && (
                  <div className="p-3.5 rounded-xl border border-surface-border bg-surface-card/70 space-y-2.5 mt-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-slate-200">
                          SenseVoice-Small 离线模型
                        </span>
                        {modelStatus?.isReady ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-950/40 text-emerald-400 border border-emerald-500/30">
                            <CheckCircle2 className="w-3 h-3" />
                            已就绪 ({modelStatus.modelSizeMb} MB)
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-950/40 text-amber-300 border border-amber-500/30">
                            <AlertTriangle className="w-3 h-3" />
                            未下载
                          </span>
                        )}
                      </div>
                    </div>

                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      采用 239MB int8 ONNX 极速量化权重，纯 CPU 资源占用低于 5%，中英文及标点识别准确，无需显卡，100% 离线隐私运行。
                    </p>

                    {/* Download Error Banner */}
                    {downloadError && (
                      <div className="p-2.5 rounded-lg bg-rose-950/30 border border-rose-500/40 text-rose-300 text-xs flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 text-rose-400 mt-0.5 shrink-0" />
                        <div className="flex-1 space-y-1">
                          <div className="font-semibold text-rose-200">模型下载遇到问题</div>
                          <p className="text-[11px] opacity-85 leading-relaxed break-all">
                            {downloadError}
                          </p>
                          <div className="text-[10px] text-rose-300/80">
                            已内置 ModelScope / HF-Mirror 多源自动故障切换，请检查网络连接后重试。
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Download button or progress */}
                    {!modelStatus?.isReady && (
                      <div className="pt-1">
                        {isDownloading ? (
                          <div className="space-y-1.5 bg-surface-darker/60 p-2.5 rounded-lg border border-surface-border">
                            <div className="flex items-center justify-between text-[11px] text-indigo-300">
                              <span className="flex items-center gap-1.5">
                                <Loader2 className="w-3 h-3 animate-spin" />
                                正在下载 {downloadProgress?.fileName || "model.int8.onnx"}...
                              </span>
                              <span>
                                {downloadProgress?.percentage ? downloadProgress.percentage.toFixed(1) : "0"}%
                                {downloadProgress?.totalBytes ? ` (${(downloadProgress.downloadedBytes / (1024 * 1024)).toFixed(1)}MB / ${(downloadProgress.totalBytes / (1024 * 1024)).toFixed(1)}MB)` : ""}
                              </span>
                            </div>
                            <div className="w-full bg-surface-card h-1.5 rounded-full overflow-hidden">
                              <div
                                className="bg-indigo-500 h-full transition-all duration-200"
                                style={{ width: `${downloadProgress?.percentage || 0}%` }}
                              />
                            </div>
                            <div className="text-[10px] text-slate-500">
                              自动尝试国内镜像源 (ModelScope / HF-Mirror)，下载完成后自动就绪。
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={handleDownloadModel}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-medium transition-colors shadow-sm"
                          >
                            <Download className="w-3.5 h-3.5" />
                            {downloadError ? "重试下载 SenseVoice-Small 模型 (~239MB)" : "一键下载 SenseVoice-Small 模型 (~239MB)"}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* LLM Provider */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                  <Key className="w-3.5 h-3.5 text-indigo-400" />
                  大语言模型纪要提供商 (LLM Provider)
                </label>
                <select
                  value={form.llmProvider}
                  onChange={(e) => {
                    const prov = e.target.value as any;
                    setForm({
                      ...form,
                      llmProvider: prov,
                      llmModel:
                        prov === "ollama"
                          ? "qwen2.5:7b"
                          : prov === "deepseek"
                          ? "deepseek-chat"
                          : "gpt-4o-mini",
                      llmApiBaseUrl:
                        prov === "ollama"
                          ? "http://127.0.0.1:11434"
                          : prov === "deepseek"
                          ? "https://api.deepseek.com"
                          : "https://api.openai.com/v1",
                    });
                  }}
                  className="w-full bg-surface-card border border-surface-border rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                >
                  <option value="ollama">本地 Ollama (完全离线·支持 Qwen-2.5-7B / 14B)</option>
                  <option value="deepseek">DeepSeek (商业云端·长文本精准推理)</option>
                  <option value="openai">OpenAI (商业云端·GPT-4o)</option>
                </select>
              </div>

              {/* Ollama Local Configuration */}
              {form.llmProvider === "ollama" && (
                <div className="p-3.5 rounded-xl border border-surface-border bg-surface-card/60 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Server className="w-3.5 h-3.5 text-indigo-400" />
                      <span className="text-xs font-semibold text-slate-200">
                        本地 Ollama 运行环境
                      </span>
                    </div>
                    {ollamaStatus?.isRunning ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-950/40 text-emerald-400 border border-emerald-500/30">
                        <CheckCircle2 className="w-3 h-3" />
                        服务在线 ({ollamaStatus.models.length} 个本地模型)
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-950/40 text-amber-300 border border-amber-500/30">
                        <AlertTriangle className="w-3 h-3" />
                        未启动 Ollama
                      </span>
                    )}
                  </div>

                  <div className="space-y-1">
                    <label className="text-[11px] font-medium text-slate-400">选择离线提炼大模型</label>
                    <select
                      value={form.llmModel}
                      onChange={(e) => setForm({ ...form, llmModel: e.target.value })}
                      className="w-full bg-surface-dark border border-surface-border rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                    >
                      <option value="qwen2.5:7b">Qwen-2.5-7B (推荐，约 4.7GB，速度极快)</option>
                      <option value="qwen2.5:14b">Qwen-2.5-14B (高质量，约 9.0GB，复杂议题)</option>
                      <option value="qwen2.5:3b">Qwen-2.5-3B (超轻量，约 2.0GB)</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[11px] font-medium text-slate-400">Ollama API 服务地址</label>
                    <input
                      type="text"
                      value={form.llmApiBaseUrl || "http://127.0.0.1:11434"}
                      onChange={(e) => setForm({ ...form, llmApiBaseUrl: e.target.value })}
                      className="w-full bg-surface-dark border border-surface-border rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                    />
                  </div>

                  <p className="text-[10px] text-slate-400 leading-relaxed">
                    💡 提示：在终端执行 <code className="text-indigo-300 bg-surface-darker px-1 py-0.5 rounded">ollama run {form.llmModel}</code>，即可自动下载并在本地纯离线运行，数据绝不上传云端。
                  </p>
                </div>
              )}

              {/* DeepSeek or OpenAI Cloud Configuration */}
              {form.llmProvider !== "ollama" && (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-300">
                      {form.llmProvider === "deepseek" ? "DeepSeek API Key" : "OpenAI API Key"} (BYOK)
                    </label>
                    <input
                      type="password"
                      value={form.llmApiKey}
                      onChange={(e) => setForm({ ...form, llmApiKey: e.target.value })}
                      placeholder={form.llmProvider === "deepseek" ? "sk-..." : "sk-..."}
                      className="w-full bg-surface-card border border-surface-border rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                    />
                    <p className="text-[11px] text-slate-500">
                      密钥仅加密保存在本地 Keychain / SQLite，绝不经过任何第三方代理。
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-300">
                      API Base URL
                    </label>
                    <input
                      type="text"
                      value={form.llmApiBaseUrl || (form.llmProvider === "deepseek" ? "https://api.deepseek.com" : "https://api.openai.com/v1")}
                      onChange={(e) => setForm({ ...form, llmApiBaseUrl: e.target.value })}
                      className="w-full bg-surface-card border border-surface-border rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>
              )}

              {/* Auto Summary */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-surface-card/60 border border-surface-border">
                <div>
                  <div className="text-xs font-medium text-slate-200">会议停止时自动生成纪要</div>
                  <div className="text-[10px] text-slate-400">录音结束后 10 秒内自动触发 LLM 结构化整理</div>
                </div>
                <input
                  type="checkbox"
                  checked={form.autoSummaryOnStop}
                  onChange={(e) => setForm({ ...form, autoSummaryOnStop: e.target.checked })}
                  className="w-4 h-4 rounded text-indigo-600 focus:ring-0 cursor-pointer"
                />
              </div>
            </>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-surface-border bg-surface-darker/60 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-medium text-slate-400 hover:bg-surface-card transition-colors"
          >
            取消
          </button>
          <button
            onClick={() => {
              onSave(form);
              onClose();
            }}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm transition-colors"
          >
            <Check className="w-3.5 h-3.5" />
            保存设置
          </button>
        </div>
      </div>
    </div>
  );
};
