import React from "react";
import "./importShareDialog.css";
import { Trans } from "react-i18next";
import { ImportShareDialogProps, ImportShareDialogState } from "./interface";
import ShareUtil from "../../../utils/file/shareUtil";
import { formatBytes } from "../../../utils/common";
import toast from "react-hot-toast";
import i18n from "../../../i18n";

class ImportShareDialog extends React.Component<
  ImportShareDialogProps,
  ImportShareDialogState
> {
  constructor(props: ImportShareDialogProps) {
    super(props);
    this.state = {
      isLoading: true,
      isImporting: false,
      progress: 0,
      inspectResult: null,
      error: null,
    };
  }

  async componentDidMount() {
    const data = this.props.importShareData;
    if (!data || !data.filePath) {
      this.setState({
        isLoading: false,
        error: i18n.t("Invalid share package"),
      });
      return;
    }

    if (data.inspected && data.inspected.ok) {
      this.setState({
        isLoading: false,
        inspectResult: data.inspected,
      });
    } else {
      const inspect = await ShareUtil.inspectSharePackage(data.filePath);
      if (!inspect.ok) {
        this.setState({
          isLoading: false,
          error: inspect.error || i18n.t("Invalid share package"),
        });
      } else {
        this.setState({
          isLoading: false,
          inspectResult: inspect,
        });
      }
    }
  }

  handleCancel = () => {
    if (this.state.isImporting) return;
    this.props.handleImportShareDialog(false);
  };

  handleImport = async () => {
    const data = this.props.importShareData;
    if (!data || !data.filePath) return;

    this.setState({ isImporting: true, progress: 0 });

    const result = await ShareUtil.importSharePackage(
      data.filePath,
      (percent) => {
        this.setState({ progress: percent });
      }
    );

    this.setState({ isImporting: false });

    if (result.ok) {
      // 刷新书库与笔记
      this.props.handleFetchBooks();
      this.props.handleFetchNotes();
      this.props.handleFetchBookmarks();

      toast.success(
        i18n.t("Successfully imported books", {
          count: result.count,
        })
      );

      if (result.renamedCount && result.renamedCount > 0) {
        toast(
          i18n.t("Renamed duplicate books", {
            count: result.renamedCount,
          })
        );
      }

      // 自动切换到对应书架
      if (result.shelfName) {
        this.props.handleMode("shelf");
        this.props.handleShelf(result.shelfName);
      }

      this.props.handleImportShareDialog(false);
    } else {
      toast.error(result.error || i18n.t("Import failed"));
    }
  };

  render() {
    if (this.state.isLoading) {
      return (
        <div className="import-share-dialog-container">
          <div className="import-share-dialog-title">
            <Trans>Import share package</Trans>
          </div>
          <div className="import-share-badge">
            <Trans>Inspecting share package...</Trans>
          </div>
        </div>
      );
    }

    if (this.state.error) {
      return (
        <div className="import-share-dialog-container">
          <div className="import-share-dialog-title">
            <Trans>Import share package</Trans>
          </div>
          <div className="import-share-error">{this.state.error}</div>
          <div className="import-share-button-container">
            <div
              className="import-share-btn-cancel"
              onClick={this.handleCancel}
            >
              <Trans>Close</Trans>
            </div>
          </div>
        </div>
      );
    }

    const manifest = this.state.inspectResult?.manifest;
    const books = manifest?.books || [];
    const totalSize = this.state.inspectResult?.totalSize || 0;
    const sourceShelf = manifest?.shelfName;

    // 确定目标书架
    let targetShelfName = sourceShelf;
    if (!targetShelfName) {
      const now = new Date();
      const year = now.getFullYear();
      const month = (now.getMonth() + 1).toString().padStart(2, "0");
      const day = now.getDate().toString().padStart(2, "0");
      targetShelfName = `导入-${year}-${month}-${day}`;
    }

    return (
      <div className="import-share-dialog-container">
        <div className="import-share-dialog-title">
          <Trans>Import share package</Trans>
        </div>

        <div className="import-share-badge-container">
          <span className="import-share-badge import-share-badge-highlight">
            <Trans i18nKey="Total books" count={books.length}>
              {"Total " + books.length + " books"}
            </Trans>
          </span>
          <span className="import-share-badge">{formatBytes(totalSize)}</span>
          <span className="import-share-badge">
            {manifest?.includesNotes ? (
              <Trans>Includes notes</Trans>
            ) : (
              <Trans>No notes</Trans>
            )}
          </span>
        </div>

        <div className="import-share-target-shelf">
          <Trans i18nKey="Target shelf notice" shelfName={targetShelfName}>
            {"Target shelf: " + targetShelfName}
          </Trans>
        </div>

        <div className="import-share-book-list">
          {books.map((b, idx) => (
            <div key={b.originalKey || idx} className="import-share-book-item">
              <span className="import-share-book-name" title={b.name}>
                {b.name}
              </span>
              <span className="import-share-book-meta">
                {(b.format || "epub").toUpperCase()} · {formatBytes(b.size || 0)}
              </span>
            </div>
          ))}
        </div>

        {this.state.isImporting && (
          <div className="import-share-progress-container">
            <div className="import-share-progress-bar-bg">
              <div
                className="import-share-progress-bar-fill"
                style={{ width: `${this.state.progress}%` }}
              />
            </div>
            <div className="import-share-progress-text">
              {this.state.progress}%
            </div>
          </div>
        )}

        <div className="import-share-button-container">
          <div
            className="import-share-btn-cancel"
            onClick={this.handleCancel}
          >
            <Trans>Cancel</Trans>
          </div>
          <button
            className="import-share-btn-confirm"
            onClick={this.handleImport}
            disabled={this.state.isImporting}
          >
            {this.state.isImporting ? (
              <Trans>Importing...</Trans>
            ) : (
              <Trans>One-click Import</Trans>
            )}
          </button>
        </div>
      </div>
    );
  }
}

export default ImportShareDialog;
