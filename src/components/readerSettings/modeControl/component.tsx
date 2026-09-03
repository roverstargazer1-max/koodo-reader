import React from "react";
import "./modeControl.css";
import { ModeControlProps, ModeControlState } from "./interface";
import { ConfigService } from "../../../assets/lib/kookit-extra-browser.min";
import { Trans } from "react-i18next";

class ModeControl extends React.Component<ModeControlProps, ModeControlState> {
  constructor(props: ModeControlProps) {
    super(props);
    this.state = {};
  }

  handleChangeMode = (mode: string) => {
    if (this.props.currentBook.format.startsWith("CB")) {
      ConfigService.setReaderConfig("comicReaderMode", mode);
    } else if (
      this.props.currentBook.format === "PDF" &&
      !ConfigService.getAllListConfig("convertPDFBooks").includes(
        this.props.currentBook.key
      )
    ) {
      ConfigService.setReaderConfig("pdfReaderMode", mode);
    } else {
      ConfigService.setReaderConfig("readerMode", mode);
    }

    this.props.handleReaderMode(mode);
    this.props.renderBookFunc();
  };
  render() {
    return (
      <div className="background-color-setting">
        <div
          className="background-color-text"
          style={{ position: "relative", bottom: "15px" }}
        >
          <Trans>View mode</Trans>
        </div>
        <div className="single-control-container">
          <div
            className="single-mode-container"
            title={this.props.t("Single page mode")}
            onClick={() => {
              this.handleChangeMode("single");
            }}
            style={this.props.readerMode === "single" ? {} : { opacity: 0.4 }}
          >
            <span className="icon-single-page single-page-icon"></span>
          </div>

          <div
            className="double-mode-container"
            title={this.props.t("Two page mode")}
            onClick={() => {
              this.handleChangeMode("double");
            }}
            style={this.props.readerMode === "double" ? {} : { opacity: 0.4 }}
          >
            <span className="icon-two-page two-page-icon"></span>
          </div>

          <div
            className="double-mode-container"
            title={this.props.t("Scroll mode")}
            onClick={() => {
              this.handleChangeMode("scroll");
            }}
            style={this.props.readerMode === "scroll" ? {} : { opacity: 0.4 }}
          >
            <span className="icon-scroll two-page-icon"></span>
          </div>

          <div
            className="double-mode-container"
            title={this.props.t("Webtoon mode")}
            onClick={() => {
              this.handleChangeMode("webtoon");
            }}
            style={this.props.readerMode === "webtoon" ? {} : { opacity: 0.4 }}
          >
            <div className="webtoon-icon-container">
              <svg
                width="44"
                height="58"
                viewBox="0 0 44 58"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                className="webtoon-mode-icon"
              >
                {/* Top Sheet */}
                <rect
                  x="1.5"
                  y="1.5"
                  width="41"
                  height="24.5"
                  rx="2.5"
                  stroke="currentColor"
                  strokeWidth="2.4"
                />
                <line
                  x1="9"
                  y1="9"
                  x2="22"
                  y2="9"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                />
                <line
                  x1="9"
                  y1="16"
                  x2="35"
                  y2="16"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                />

                {/* Vertical continuous flow connector */}
                <line
                  x1="15"
                  y1="26"
                  x2="15"
                  y2="32"
                  stroke="currentColor"
                  strokeWidth="2"
                />
                <line
                  x1="29"
                  y1="26"
                  x2="29"
                  y2="32"
                  stroke="currentColor"
                  strokeWidth="2"
                />

                {/* Bottom Sheet */}
                <rect
                  x="1.5"
                  y="32"
                  width="41"
                  height="24.5"
                  rx="2.5"
                  stroke="currentColor"
                  strokeWidth="2.4"
                />
                <line
                  x1="9"
                  y1="39.5"
                  x2="35"
                  y2="39.5"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                />
                <line
                  x1="9"
                  y1="47"
                  x2="25"
                  y2="47"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                />
              </svg>
            </div>
          </div>
        </div>
      </div>
    );
  }
}
export default ModeControl;
