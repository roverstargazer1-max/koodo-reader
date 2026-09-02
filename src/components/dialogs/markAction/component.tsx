import React from "react";
import "../actionDialog/actionDialog.css";
import { Trans } from "react-i18next";
import { MarkActionProps } from "./interface";
import toast from "react-hot-toast";
import { ConfigService } from "../../../assets/lib/kookit-extra-browser.min";
import {
  clampMenuPosition,
  CONTEXT_MENU_WIDTH,
  estimateMenuHeight,
  SUBMENU_GAP,
} from "../../../utils/common";

const MENU_ITEM_HEIGHT = 33;
const MENU_CONTAINER_PADDING = 5;
const MARK_AS_MENU_INDEX = 6;
const SUBMENU_TOP_OFFSET =
  MENU_CONTAINER_PADDING + MARK_AS_MENU_INDEX * MENU_ITEM_HEIGHT - 34;

class MarkAction extends React.Component<MarkActionProps> {
  handleMarkAsFinished = () => {
    const key = this.props.currentBook.key;
    const existing = ConfigService.getObjectConfig(key, "recordLocation", {});
    ConfigService.setObjectConfig(
      key,
      { ...existing, percentage: "1" },
      "recordLocation"
    );
    toast.success(this.props.t("Modification successful"));
    this.props.handleRefreshBookCover(key);
    this.props.handleFetchBooks();
    this.props.handleMarkAction(false);
    this.props.handleActionDialog(false);
  };

  handleMarkAsUnread = () => {
    const key = this.props.currentBook.key;
    ConfigService.deleteObjectConfig(key, "recordLocation");
    toast.success(this.props.t("Modification successful"));
    this.props.handleRefreshBookCover(key);
    this.props.handleFetchBooks();
    this.props.handleMarkAction(false);
    this.props.handleActionDialog(false);
  };

  handleToggleBlur = () => {
    const key = this.props.currentBook.key;
    const isBlurred =
      ConfigService.getAllListConfig("blurredBooks").indexOf(key) > -1;
    if (isBlurred) {
      ConfigService.deleteListConfig(key, "blurredBooks");
    } else {
      ConfigService.setListConfig(key, "blurredBooks");
    }
    toast.success(this.props.t("Modification successful"));
    this.props.handleRefreshBookCover(key);
    this.props.handleFetchBooks();
    this.props.handleMarkAction(false);
    this.props.handleActionDialog(false);
  };

  render() {
    const isBlurred =
      ConfigService.getAllListConfig("blurredBooks").indexOf(
        this.props.currentBook.key
      ) > -1;
    return (
      <div
        className="action-dialog-container"
        onMouseLeave={() => {
          this.props.handleMarkAction(false);
          this.props.handleActionDialog(false);
        }}
        onMouseEnter={(event) => {
          this.props.handleMarkAction(true);
          this.props.handleActionDialog(true);
          event?.stopPropagation();
        }}
        style={
          this.props.isShowMark
            ? (() => {
                const pos = clampMenuPosition(
                  this.props.left +
                    (this.props.isExceed ? -SUBMENU_GAP : SUBMENU_GAP),
                  this.props.top + SUBMENU_TOP_OFFSET,
                  CONTEXT_MENU_WIDTH,
                  estimateMenuHeight(3)
                );
                return {
                  position: "fixed",
                  left: pos.left,
                  top: pos.top,
                };
              })()
            : { display: "none" }
        }
      >
        <div className="action-dialog-actions-container">
          <div
            className="action-dialog-edit"
            style={{ paddingLeft: "0px" }}
            onClick={() => {
              this.handleMarkAsFinished();
            }}
          >
            <p className="action-name">
              <Trans>Mark as finished</Trans>
            </p>
          </div>
          <div
            className="action-dialog-edit"
            style={{ paddingLeft: "0px" }}
            onClick={() => {
              this.handleMarkAsUnread();
            }}
          >
            <p className="action-name">
              <Trans>Mark as unread</Trans>
            </p>
          </div>
          <div
            className="action-dialog-edit"
            style={{ paddingLeft: "0px" }}
            onClick={() => {
              this.handleToggleBlur();
            }}
          >
            <p className="action-name">
              {isBlurred ? (
                <Trans>Unblur cover</Trans>
              ) : (
                <Trans>Blur cover</Trans>
              )}
            </p>
          </div>
        </div>
      </div>
    );
  }
}

export default MarkAction;
