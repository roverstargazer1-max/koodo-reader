import React from "react";
import "./translationWidget.css";
import { TranslationWidgetProps, TranslationWidgetState } from "./interface";
import { GlobalTranslationManager } from "../../utils/translation/translationManager";
import { TranslationProgress } from "../../utils/translation/scheduler/types";

class TranslationWidget extends React.Component<
  TranslationWidgetProps,
  TranslationWidgetState
> {
  private unsubscribe?: () => void;

  constructor(props: TranslationWidgetProps) {
    super(props);
    this.state = {
      progress: GlobalTranslationManager.getProgress(),
      isVisible: GlobalTranslationManager.isWidgetVisible(),
    };
  }

  componentDidMount() {
    this.unsubscribe = GlobalTranslationManager.subscribe(
      (progress: TranslationProgress) => {
        this.setState({
          progress,
          isVisible: GlobalTranslationManager.isWidgetVisible(),
        });
      }
    );
  }

  componentWillUnmount() {
    if (this.unsubscribe) {
      this.unsubscribe();
    }
  }

  handleClick = () => {
    GlobalTranslationManager.setMinimized(false);
    GlobalTranslationManager.setDialogOpen(true);
    if (this.props.onRestore) {
      this.props.onRestore();
    }
  };

  render() {
    const { progress } = this.state;
    const isVisible = GlobalTranslationManager.isWidgetVisible();

    if (!isVisible || !progress) {
      return null;
    }

    const isPaused =
      progress.status === "paused" || progress.status === "paused_error";
    const isError = progress.status === "paused_error";
    const label = isError
      ? "翻译出错"
      : isPaused
      ? "翻译已暂停"
      : "AI 翻译中";

    return (
      <div
        className="translation-floating-widget"
        onClick={this.handleClick}
        title={`${progress.currentChapterTitle || "准备中..."} (${progress.percentage}%) - 点击查看翻译进度`}
      >
        <span
          className={`icon-translate translation-widget-icon ${
            isPaused ? "paused" : ""
          }`}
        />
        <span className="translation-widget-label">{label}</span>
        <span className="translation-widget-percentage">
          {progress.percentage}%
        </span>
        <span
          className={`translation-widget-status-dot ${
            isError ? "error" : isPaused ? "paused" : ""
          }`}
        />
      </div>
    );
  }
}

export default TranslationWidget;
