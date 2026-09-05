import React from "react";
import "./translateBookDialog.css";
import {
  TranslateBookDialogProps,
  TranslateBookDialogState,
} from "./interface";
import {
  TranslationLayoutMode,
  TranslationModelOption,
  TranslationTaskConfig,
} from "../../../utils/translation/types";
import { GlobalTranslationManager } from "../../../utils/translation/translationManager";
import { ConfigService } from "../../../assets/lib/kookit-extra-browser.min";
import { TranslationProgress } from "../../../utils/translation/scheduler/types";
import toast from "react-hot-toast";
import i18n from "../../../i18n";
import { Trans } from "react-i18next";

const DEFAULT_LITERARY_PROMPT =
  "你是一名精通文学翻译的大师级翻译家。请在精准传递原文含义的同时，保留其文学语感、语气和文化意蕴。译文必须通顺流畅、自然生动、符合目标语言的表达习惯。";

const LANGUAGE_OPTIONS = [
  { code: "auto", name: "自动识别语言" },
  { code: "zh", name: "简体中文" },
  { code: "zh-TW", name: "繁体中文" },
  { code: "en", name: "英语 (English)" },
  { code: "ja", name: "日语 (日本語)" },
  { code: "ko", name: "韩语 (한국어)" },
  { code: "fr", name: "法语 (Français)" },
  { code: "de", name: "德语 (Deutsch)" },
  { code: "es", name: "西班牙语 (Español)" },
  { code: "ru", name: "俄语 (Русский)" },
];

class TranslateBookDialog extends React.Component<
  TranslateBookDialogProps,
  TranslateBookDialogState
> {
  private unsubscribe?: () => void;

  constructor(props: TranslateBookDialogProps) {
    super(props);

    const targetLang =
      ConfigService.getReaderConfig("lang")?.toLowerCase().startsWith("zh")
        ? "zh"
        : ConfigService.getReaderConfig("lang") || "zh";

    const savedPrompt =
      ConfigService.getReaderConfig("defaultTranslationPrompt") ||
      DEFAULT_LITERARY_PROMPT;

    const initialTitle = `${props.currentBook.name} (${
      targetLang === "zh" ? "中文版" : "Translated Edition"
    })`;

    this.state = {
      step: "config",
      sourceLanguage: "auto",
      targetLanguage: targetLang,
      selectedModelKey: "",
      availableModels: [],
      layoutMode: "pure",
      systemPrompt: savedPrompt,
      isSaveDefaultPrompt: false,
      targetTitle: initialTitle,
      existingTask: null,
      progress: GlobalTranslationManager.getProgress(),
      isCancelling: false,
      isResuming: false,
    };
  }

  async componentDidMount() {
    this.loadModels();

    // Check if an existing task is already running or paused
    const activeProgress = GlobalTranslationManager.getProgress();
    const activeBook = GlobalTranslationManager.getActiveBook();

    if (
      activeProgress &&
      activeBook?.key === this.props.currentBook.key &&
      (activeProgress.status === "running" ||
        activeProgress.status === "paused" ||
        activeProgress.status === "paused_error")
    ) {
      const incomplete = await GlobalTranslationManager.checkForIncompleteTask(
        this.props.currentBook.key
      );
      this.setState({
        step: "progress",
        progress: activeProgress,
        existingTask: incomplete,
        selectedModelKey:
          incomplete?.config.modelConfig.key ||
          GlobalTranslationManager.getActiveConfig()?.modelConfig.key ||
          this.state.selectedModelKey,
      });
    } else {
      const incomplete = await GlobalTranslationManager.checkForIncompleteTask(
        this.props.currentBook.key
      );
      if (incomplete) {
        this.setState({
          step: "resume_prompt",
          existingTask: incomplete,
          targetTitle: incomplete.config.targetTitle,
          layoutMode: incomplete.config.layoutMode,
          targetLanguage: incomplete.config.targetLanguage,
          selectedModelKey: incomplete.config.modelConfig.key,
        });
      }
    }

    this.unsubscribe = GlobalTranslationManager.subscribe(
      (progress: TranslationProgress) => {
        if (progress.bookKey === this.props.currentBook.key) {
          this.setState({ progress, isResuming: false });
        }
      }
    );
  }

  componentWillUnmount() {
    if (this.unsubscribe) {
      this.unsubscribe();
    }
  }

  private loadModels() {
    const rawMap = ConfigService.getAllMapConfig("aiModelConfig") || {};
    const models: TranslationModelOption[] = [];

    for (const key in rawMap) {
      const entry = rawMap[key];
      if (entry && entry.config) {
        models.push({
          key: entry.key,
          displayName:
            entry.displayName || entry.config.modelName || entry.config.modelId,
          modelId: entry.config.modelId,
          endpoint: entry.config.endpoint,
          apiKey: entry.config.apiKey,
          providerId: entry.config.providerId || "custom",
        });
      }
    }

    const defaultModelKey =
      ConfigService.getReaderConfig("aiTranslateModel") ||
      (models.length > 0 ? models[0].key : "");

    this.setState({
      availableModels: models,
      selectedModelKey: defaultModelKey,
    });
  }

  handleStartNewTask = async () => {
    const {
      sourceLanguage,
      targetLanguage,
      selectedModelKey,
      availableModels,
      layoutMode,
      systemPrompt,
      isSaveDefaultPrompt,
      targetTitle,
    } = this.state;

    const chosenModel = availableModels.find((m) => m.key === selectedModelKey);
    if (!chosenModel) {
      toast.error(
        i18n.t(
          "Please configure personal AI API in Setting -> AI service first"
        )
      );
      return;
    }

    if (isSaveDefaultPrompt) {
      ConfigService.setReaderConfig("defaultTranslationPrompt", systemPrompt);
    }

    const format =
      this.props.currentBook.format.toLowerCase() === "txt" ? "txt" : "epub";

    const config: TranslationTaskConfig = {
      bookKey: this.props.currentBook.key,
      originalTitle: this.props.currentBook.name,
      targetTitle: targetTitle || `${this.props.currentBook.name} (Translated)`,
      format,
      sourceLanguage,
      targetLanguage,
      layoutMode,
      systemPrompt,
      modelConfig: chosenModel,
    };

    GlobalTranslationManager.setRefreshLibraryCallback(() => {
      if (this.props.onRefreshBooks) {
        this.props.onRefreshBooks();
      }
    });

    GlobalTranslationManager.setOpenBookCallback((b) => {
      if (this.props.onOpenBook) {
        this.props.onOpenBook(b);
      }
    });

    this.setState({ step: "progress" });
    await GlobalTranslationManager.startTask(this.props.currentBook, config);
  };

  handleResumeTask = async () => {
    // 1. Reload latest models in case API key or endpoint was updated in Settings
    this.loadModels();
    const rawMap = ConfigService.getAllMapConfig("aiModelConfig") || {};
    const latestModels: TranslationModelOption[] = [];
    for (const key in rawMap) {
      const entry = rawMap[key];
      if (entry && entry.config) {
        latestModels.push({
          key: entry.key,
          displayName:
            entry.displayName || entry.config.modelName || entry.config.modelId,
          modelId: entry.config.modelId,
          endpoint: entry.config.endpoint,
          apiKey: entry.config.apiKey,
          providerId: entry.config.providerId || "custom",
        });
      }
    }

    // 2. Resolve existing task config with multi-level fallback
    let task = this.state.existingTask;
    if (!task) {
      task = await GlobalTranslationManager.checkForIncompleteTask(
        this.props.currentBook.key
      );
    }
    const activeConfig = GlobalTranslationManager.getActiveConfig();
    const baseConfig = task?.config || activeConfig;
    if (!baseConfig) {
      toast.error("未找到可恢复的任务配置");
      return;
    }

    // 3. Determine which model to use (support switching models on pause/error)
    const targetModelKey =
      this.state.selectedModelKey || baseConfig.modelConfig.key;
    const chosenModel =
      latestModels.find((m) => m.key === targetModelKey) ||
      latestModels.find((m) => m.key === baseConfig.modelConfig.key) ||
      baseConfig.modelConfig;

    const config: TranslationTaskConfig = {
      ...baseConfig,
      modelConfig: chosenModel,
    };

    // 4. Instant UI response: Set isResuming, clear errorMessage, update status to running
    this.setState({
      step: "progress",
      isResuming: true,
      existingTask: task,
      progress: this.state.progress
        ? {
            ...this.state.progress,
            status: "running",
            errorMessage: undefined,
          }
        : null,
    });

    toast.loading("正在连接 AI 恢复翻译...", {
      id: "resume-toast",
      duration: 2500,
    });

    try {
      await GlobalTranslationManager.resumeTask(this.props.currentBook, config);
    } catch (e: any) {
      console.warn("Resume task failed:", e);
    } finally {
      this.setState({ isResuming: false });
    }
  };

  handlePauseOrResume = () => {
    const { progress, isResuming } = this.state;
    if (isResuming) return;
    if (!progress) return;

    if (progress.status === "running") {
      GlobalTranslationManager.pauseTask();
    } else {
      this.handleResumeTask();
    }
  };

  handleMinimize = () => {
    GlobalTranslationManager.setMinimized(true);
    this.props.onClose();
  };

  handleCancelTask = async () => {
    if (!this.state.isCancelling) {
      this.setState({ isCancelling: true });
      return;
    }
    await GlobalTranslationManager.cancelTask();
    this.props.onClose();
  };

  renderConfigStep() {
    const {
      sourceLanguage,
      targetLanguage,
      selectedModelKey,
      availableModels,
      layoutMode,
      systemPrompt,
      isSaveDefaultPrompt,
      targetTitle,
    } = this.state;

    const book = this.props.currentBook;
    const format = book.format.toUpperCase();
    const sizeKb = book.size ? Math.round(book.size / 1024) : 0;

    return (
      <>
        <div className="translate-dialog-book-meta">
          <div className="translate-dialog-meta-row">
            <span className="translate-dialog-meta-label">原书名称:</span>
            <span className="translate-dialog-meta-value">{book.name}</span>
          </div>
          <div className="translate-dialog-meta-row">
            <span className="translate-dialog-meta-label">文件格式:</span>
            <span className="translate-dialog-meta-value">{format}</span>
          </div>
          <div className="translate-dialog-meta-row">
            <span className="translate-dialog-meta-label">文件大小:</span>
            <span className="translate-dialog-meta-value">{sizeKb} KB</span>
          </div>
          <div className="translate-dialog-meta-row" style={{ marginTop: "4px", opacity: 0.7, fontSize: "11px" }}>
            <span>💡 全书 AI 翻译当前处于 Beta 测试阶段，欢迎体验与反馈</span>
          </div>
        </div>

        <div className="translate-dialog-form-item">
          <label className="translate-dialog-label">译本名称</label>
          <input
            className="translate-dialog-input"
            value={targetTitle}
            placeholder="请输入新生成的译本书名"
            onChange={(e) => this.setState({ targetTitle: e.target.value })}
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
          <div className="translate-dialog-form-item">
            <label className="translate-dialog-label">源语言</label>
            <select
              className="translate-dialog-select"
              value={sourceLanguage}
              onChange={(e) => this.setState({ sourceLanguage: e.target.value })}
            >
              {LANGUAGE_OPTIONS.map((opt) => (
                <option key={opt.code} value={opt.code}>
                  {opt.name}
                </option>
              ))}
            </select>
          </div>

          <div className="translate-dialog-form-item">
            <label className="translate-dialog-label">目标语言</label>
            <select
              className="translate-dialog-select"
              value={targetLanguage}
              onChange={(e) => this.setState({ targetLanguage: e.target.value })}
            >
              {LANGUAGE_OPTIONS.filter((opt) => opt.code !== "auto").map((opt) => (
                <option key={opt.code} value={opt.code}>
                  {opt.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="translate-dialog-form-item">
          <label className="translate-dialog-label">翻译 AI 模型</label>
          {availableModels.length === 0 ? (
            <div style={{ fontSize: "12px", color: "#ff4d4f" }}>
              未检测到已配置的 AI 模型。请先前往【设置】-&gt;【AI】中配置并启用至少一个模型。
            </div>
          ) : (
            <select
              className="translate-dialog-select"
              value={selectedModelKey}
              onChange={(e) => this.setState({ selectedModelKey: e.target.value })}
            >
              {availableModels.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.displayName} ({m.modelId})
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="translate-dialog-form-item">
          <label className="translate-dialog-label">排版格式</label>
          <div className="translate-dialog-radio-group">
            <label className="translate-dialog-radio-label">
              <input
                type="radio"
                name="layoutMode"
                value="pure"
                checked={layoutMode === "pure"}
                onChange={() => this.setState({ layoutMode: "pure" })}
              />
              仅译文版 (替换原书文本)
            </label>
            <label className="translate-dialog-radio-label">
              <input
                type="radio"
                name="layoutMode"
                value="bilingual"
                checked={layoutMode === "bilingual"}
                onChange={() => this.setState({ layoutMode: "bilingual" })}
              />
              双语对照版 (原文下方展示译文)
            </label>
          </div>
        </div>

        <div className="translate-dialog-form-item">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <label className="translate-dialog-label" style={{ marginBottom: 0 }}>系统翻译提示词</label>
            <span
              style={{
                fontSize: "12px",
                color: "var(--primary-color, #1890ff)",
                cursor: "pointer",
                userSelect: "none",
              }}
              onClick={() => this.setState({ systemPrompt: DEFAULT_LITERARY_PROMPT })}
            >
              恢复默认提示词
            </span>
          </div>
          <textarea
            className="translate-dialog-textarea"
            value={systemPrompt}
            style={{ marginTop: "6px" }}
            placeholder="输入自定义翻译要求，例如术语风格或特定人名翻译规则..."
            onChange={(e) => this.setState({ systemPrompt: e.target.value })}
          />
          <label className="translate-dialog-checkbox-label">
            <input
              type="checkbox"
              checked={isSaveDefaultPrompt}
              onChange={(e) =>
                this.setState({ isSaveDefaultPrompt: e.target.checked })
              }
            />
            保存为默认提示词 (后续翻译通用)
          </label>
        </div>

        <div className="translate-dialog-footer">
          <button
            className="translate-dialog-btn"
            onClick={this.props.onClose}
          >
            取消
          </button>
          <button
            className="translate-dialog-btn translate-dialog-btn-primary"
            disabled={availableModels.length === 0}
            onClick={this.handleStartNewTask}
          >
            开始翻译
          </button>
        </div>
      </>
    );
  }

  renderResumePromptStep() {
    const { existingTask } = this.state;
    if (!existingTask) return null;

    return (
      <>
        <div className="translate-dialog-book-meta">
          <p style={{ margin: "0 0 8px 0", fontWeight: 600 }}>
            检测到此书存在未完成的翻译任务:
          </p>
          <div className="translate-dialog-meta-row">
            <span className="translate-dialog-meta-label">翻译进度:</span>
            <span className="translate-dialog-meta-value">
              {existingTask.completedChunks} / {existingTask.totalChunks} 分块 (
              {Math.round(
                (existingTask.completedChunks / (existingTask.totalChunks || 1)) *
                  100
              )}
              %)
            </span>
          </div>
          <div className="translate-dialog-meta-row">
            <span className="translate-dialog-meta-label">译本名称:</span>
            <span className="translate-dialog-meta-value">
              {existingTask.config.targetTitle}
            </span>
          </div>
          <div className="translate-dialog-meta-row">
            <span className="translate-dialog-meta-label">最后更新时间:</span>
            <span className="translate-dialog-meta-value">
              {new Date(existingTask.updatedAt).toLocaleString()}
            </span>
          </div>
        </div>

        <p style={{ fontSize: "13px", color: "var(--sub-title-color, #666)" }}>
          您希望从上次中断处继续翻译，还是放弃进度重新开始？
        </p>

        <div className="translate-dialog-footer">
          <button
            className="translate-dialog-btn"
            onClick={() => this.setState({ step: "config" })}
          >
            重新开始
          </button>
          <button
            className="translate-dialog-btn translate-dialog-btn-primary"
            onClick={this.handleResumeTask}
          >
            继续翻译
          </button>
        </div>
      </>
    );
  }

  renderProgressStep() {
    const {
      progress,
      isCancelling,
      isResuming,
      availableModels,
      selectedModelKey,
    } = this.state;
    const p = progress || {
      percentage: 0,
      currentChapterTitle: "准备中...",
      completedChunks: 0,
      totalChunks: 1,
      translatedWords: 0,
      timeRemainingSec: 0,
      status: "running" as const,
      errorMessage: undefined as string | undefined,
    };

    const isPaused = p.status === "paused" || p.status === "paused_error";
    const isError = p.status === "paused_error";
    const isRetrying =
      !isError && !!p.errorMessage && p.errorMessage.includes("重试");

    const formatSec = (sec: number) => {
      if (!sec || sec <= 0) return "--:--";
      const m = Math.floor(sec / 60);
      const s = sec % 60;
      return `${m < 10 ? "0" : ""}${m}:${s < 10 ? "0" : ""}${s}`;
    };

    return (
      <div className="translate-progress-view">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span
            className={`translate-progress-status-badge ${
              isResuming
                ? "status-badge-running"
                : isError
                ? "status-badge-error"
                : isPaused
                ? "status-badge-paused"
                : "status-badge-running"
            }`}
          >
            {isResuming ? (
              <>
                <span
                  className="translate-spinner"
                  style={{
                    borderTopColor: "#1890ff",
                    borderColor: "rgba(24, 144, 255, 0.25)",
                  }}
                />
                正在连接恢复...
              </>
            ) : isError ? (
              "已暂停 (发生错误)"
            ) : isPaused ? (
              "已暂停"
            ) : (
              "正在翻译..."
            )}
          </span>
          <span style={{ fontSize: "18px", fontWeight: 700 }}>
            {p.percentage}%
          </span>
        </div>

        <div className="translate-progress-bar-bg">
          <div
            className="translate-progress-bar-fill"
            style={{ width: `${p.percentage}%` }}
          />
        </div>

        <div className="translate-progress-stats-grid">
          <div className="translate-progress-stat-item">
            <span className="translate-progress-stat-label">当前章节</span>
            <span
              className="translate-progress-stat-value"
              style={{
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {p.currentChapterTitle || "准备中..."}
            </span>
          </div>
          <div className="translate-progress-stat-item">
            <span className="translate-progress-stat-label">已完成分块</span>
            <span className="translate-progress-stat-value">
              {p.completedChunks} / {p.totalChunks}
            </span>
          </div>
          <div className="translate-progress-stat-item">
            <span className="translate-progress-stat-label">已译字数/词数</span>
            <span className="translate-progress-stat-value">
              {p.translatedWords}
            </span>
          </div>
          <div className="translate-progress-stat-item">
            <span className="translate-progress-stat-label">预估剩余时间</span>
            <span className="translate-progress-stat-value">
              {formatSec(p.timeRemainingSec)}
            </span>
          </div>
        </div>

        {/* Dynamic Retry Notice during background retries */}
        {isRetrying && (
          <div className="translate-retry-notice">
            <span className="translate-spinner" />
            <span>{p.errorMessage}</span>
          </div>
        )}

        {/* Error panel with error message and quick model switcher */}
        {isError && p.errorMessage && (
          <div className="translate-error-panel">
            <div className="translate-error-message">
              <strong>错误提示：</strong>
              {p.errorMessage}
            </div>
            {availableModels.length > 0 && (
              <div className="translate-model-switch-row">
                <span>更换 AI 模型继续：</span>
                <select
                  className="translate-model-switch-select"
                  value={selectedModelKey}
                  onChange={(e) =>
                    this.setState({ selectedModelKey: e.target.value })
                  }
                >
                  {availableModels.map((m) => (
                    <option key={m.key} value={m.key}>
                      {m.displayName}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        )}

        <div
          className="translate-dialog-footer"
          style={{ justifyContent: "space-between" }}
        >
          <div>
            <button
              className="translate-dialog-btn translate-dialog-btn-danger"
              onClick={this.handleCancelTask}
              disabled={isResuming}
            >
              {isCancelling ? "确认取消任务？" : "取消任务"}
            </button>
          </div>

          <div style={{ display: "flex", gap: "10px" }}>
            <button
              className="translate-dialog-btn"
              onClick={this.handleMinimize}
              title="最小化至右下角后台悬浮窗"
            >
              最小化
            </button>
            <button
              className="translate-dialog-btn translate-dialog-btn-primary"
              onClick={this.handlePauseOrResume}
              disabled={isResuming}
            >
              {isResuming ? (
                <>
                  <span className="translate-spinner" />
                  正在继续...
                </>
              ) : isPaused ? (
                "继续"
              ) : (
                "暂停"
              )}
            </button>
          </div>
        </div>
      </div>
    );
  }

  render() {
    if (!this.props.isOpen) return null;

    const { step } = this.state;

    return (
      <div className="translate-book-backdrop" onClick={this.handleMinimize}>
        <div
          className="translate-book-dialog-container"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="translate-dialog-header">
            <div className="translate-dialog-title">
              <span className="icon-translate" style={{ color: "var(--primary-color, #1890ff)" }} />
              <span>整本书 AI 翻译</span>
              <span className="translate-beta-badge">Beta</span>
            </div>
            <div className="translate-dialog-header-actions">
              {step === "progress" && (
                <button
                  className="translate-dialog-icon-btn"
                  onClick={this.handleMinimize}
                  title="最小化至后台悬浮窗"
                >
                  <span className="icon-minus" />
                </button>
              )}
              <button
                className="translate-dialog-icon-btn"
                onClick={step === "progress" ? this.handleMinimize : this.props.onClose}
                title="关闭"
              >
                <span className="icon-close" />
              </button>
            </div>
          </div>

          {step === "config" && this.renderConfigStep()}
          {step === "resume_prompt" && this.renderResumePromptStep()}
          {step === "progress" && this.renderProgressStep()}
        </div>
      </div>
    );
  }
}

export default TranslateBookDialog;
