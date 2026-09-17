# InviMeet (会议副驾) - Tauri 2.0 基础框架

基于 PRD `meeting_ai_assistant_feasibility_and_spec.md` 构建的 **跨平台非侵入式双轨会议 AI 助手** 桌面端基础框架。

---

## 核心特性与架构落地

1. **Tauri 2.0 双窗口架构**
   - **极简置顶悬浮胶囊 (`pill`)**：无边框 (`decorations: false`)、透明背景、鼠标穿透置顶 (`alwaysOnTop: true`)，支持实时双轨音量柱状波形、录制计时器与一键启停。
   - **主工作台抽屉 (`main`)**：双栏布局，左侧会议历史与标签检索，右侧双轨实时对话流与结构化 AI 会议纪要。
2. **双轨物理分角色机制**
   - **麦克风 (轨道 A)**：捕获【我】的声音。
   - **扬声器环回 (轨道 B)**：捕获【参会对方】的声音（Windows WASAPI Loopback / macOS ScreenCaptureKit Audio-Only 原生免驱动截流）。
   - 对话流按 `[我]`（右侧高亮气泡）与 `[参会对方]`（左侧暗色气泡）物理分流展示。
3. **AI 纪要与待办提炼管线**
   - 严格遵循 PRD 第五节的 Prompt 约束规范（过滤语气助词、事实严谨、提取议题共识与可执行待办清单）。
   - 一键 Markdown 导出与待办事项交互勾选。
4. **即开即用的仿真与调试支持 (Mock Fallback)**
   - 前端内置高仿真引擎，无需开启系统声卡驱动或未编译 Rust 时，即可在浏览器或桌面端实时体验波形跳动、双轨对话模拟与 AI 纪要生成。

---

## 项目目录结构

```text
InviMeet/
├── meeting_ai_assistant_feasibility_and_spec.md # 原始 PRD 产品说明书
├── package.json                                 # 前端依赖配置 (Vite + React 18 + TS + Tailwind)
├── pnpm-workspace.yaml                          # pnpm 配置
├── vite.config.ts                               # Vite 构建与 Tauri 端口配置
├── tailwind.config.js                           # 暗色沉浸式主题配置
├── index.html                                   # 应用 HTML 入口
├── src/                                         # 前端源码
│   ├── App.tsx                                  # 窗口路由器 (自适应加载 pill 或 main)
│   ├── main.tsx                                 # React 入口
│   ├── types/
│   │   └── meeting.ts                           # 会议、双轨对话片段、AI 纪要类型定义
│   ├── lib/
│   │   └── tauriBridge.ts                       # Tauri 2.0 IPC 桥接与 Mock 仿真引擎
│   ├── components/
│   │   ├── AudioWaveform.tsx                    # 双轨实时音量波形组件
│   │   ├── TranscriptStream.tsx                 # 双轨分角色实时流组件
│   │   ├── SummaryCard.tsx                      # 结构化 AI 纪要卡片组件
│   │   ├── MeetingSidebar.tsx                   # 历史会议与标签搜索侧边栏
│   │   └── SettingsDialog.tsx                   # 音频设备与 LLM API 设置弹窗
│   └── windows/
│       ├── PillWindow.tsx                       # 悬浮小胶囊窗口
│       └── MainWindow.tsx                       # 完整主工作台窗口
└── src-tauri/                                   # Tauri 2.0 本地原生宿主 (Rust)
    ├── Cargo.toml                               # Rust 依赖 (tauri 2.0, cpal, tokio, reqwest, serde)
    ├── tauri.conf.json                          # Tauri 2.0 双窗口及系统配置
    ├── capabilities/
    │   └── default.json                         # Tauri 2.0 权限安全策略
    └── src/
        ├── main.rs                              # 原生程序入口
        ├── lib.rs                               # Tauri Builder 与 Commands 注册
        ├── models.rs                            # 数据模型与序列化
        ├── commands.rs                          # Tauri IPC 命令处理器
        ├── audio/mod.rs                         # 底层双轨音频采集与重采样抽象
        ├── asr/mod.rs                           # 语音识别分流调度引擎
        ├── llm/mod.rs                           # PRD 规范的 LLM 结构化纪要提炼
        └── storage/mod.rs                       # 会议数据管理与本地存储
```

---

## 快速上手与运行

### 1. 运行前端开发预览（浏览器端）

```bash
# 启动开发服务器
pnpm dev

# 在浏览器中访问：
# 主工作台：http://localhost:1420/?window=main
# 悬浮胶囊：http://localhost:1420/?window=pill
```

### 2. 验证前端编译构建

```bash
pnpm build
```

### 3. 运行 Tauri 桌面端应用

*前提：本机需已安装 Rust 环境（若未安装可通过 `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh` 或 `brew install rust` 安装）。*

```bash
# 启动 Tauri 2.0 桌面端应用（开发模式）
pnpm tauri dev

# 打包全平台可执行安装包
pnpm tauri build
```
