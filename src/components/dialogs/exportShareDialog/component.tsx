import React from "react";
import "./exportShareDialog.css";
import { Trans } from "react-i18next";
import { ExportShareDialogProps, ExportShareDialogState } from "./interface";
import ShareUtil from "../../../utils/file/shareUtil";
import { formatBytes } from "../../../utils/common";

class ExportShareDialog extends React.Component<
  ExportShareDialogProps,
  ExportShareDialogState
> {
  constructor(props: ExportShareDialogProps) {
    super(props);
    this.state = {
      includeNotes: true,
      isExporting: false,
      progress: 0,
    };
  }

  handleCancel = () => {
    if (this.state.isExporting) return;
    this.props.handleExportShareDialog(false);
  };

  handleExport = async () => {
    const data = this.props.exportShareData;
    if (!data || !data.books || data.books.length === 0) return;

    this.setState({ isExporting: true });
    const success = await ShareUtil.exportSharePackage(
      data.books,
      data.shelfName,
      this.state.includeNotes
    );
    this.setState({ isExporting: false });
    if (success) {
      this.props.handleExportShareDialog(false);
    }
  };

  render() {
    const data = this.props.exportShareData;
    const books = data?.books || [];
    const shelfName = data?.shelfName;
    const totalSize = books.reduce((acc, b) => acc + (b.size || 0), 0);

    return (
      <div className="export-share-dialog-container">
        <div className="export-share-dialog-title">
          {shelfName ? (
            <Trans i18nKey="Share shelf title" shelfName={shelfName}>
              {"Share shelf: " + shelfName}
            </Trans>
          ) : (
            <Trans>Share selected books</Trans>
          )}
        </div>

        <div className="export-share-dialog-info">
          <span>
            <Trans i18nKey="Total books" count={books.length}>
              {"Total " + books.length + " books"}
            </Trans>
          </span>
          <span>{formatBytes(totalSize)}</span>
        </div>

        <div className="export-share-book-list">
          {books.map((b) => (
            <div key={b.key} className="export-share-book-item">
              <span className="export-share-book-name" title={b.name}>
                {b.name}
              </span>
              <span className="export-share-book-meta">
                {(b.format || "epub").toUpperCase()} · {formatBytes(b.size || 0)}
              </span>
            </div>
          ))}
        </div>

        <label className="export-share-option-row">
          <input
            type="checkbox"
            checked={this.state.includeNotes}
            onChange={(e) => this.setState({ includeNotes: e.target.checked })}
            disabled={this.state.isExporting}
          />
          <span className="export-share-option-label">
            <Trans>Include notes and highlights</Trans>
          </span>
        </label>

        <div className="export-share-button-container">
          <div
            className="export-share-btn-cancel"
            onClick={this.handleCancel}
          >
            <Trans>Cancel</Trans>
          </div>
          <button
            className="export-share-btn-confirm"
            onClick={this.handleExport}
            disabled={this.state.isExporting}
          >
            {this.state.isExporting ? (
              <Trans>Exporting...</Trans>
            ) : (
              <Trans>Export share package</Trans>
            )}
          </button>
        </div>
      </div>
    );
  }
}

export default ExportShareDialog;
