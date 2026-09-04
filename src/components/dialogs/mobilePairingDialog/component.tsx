import React from "react";
import "./mobilePairingDialog.css";
import { Trans, withTranslation, WithTranslation } from "react-i18next";
import copy from "copy-text-to-clipboard";
import toast from "react-hot-toast";
import {
  MobilePairingDialogProps,
  MobilePairingDialogState,
  MobileServerStatus,
} from "./interface";
import { generateQrSvg } from "../../../utils/mobile/qrGenerator";

interface Props extends MobilePairingDialogProps, WithTranslation {}

class MobilePairingDialog extends React.Component<Props, MobilePairingDialogState> {
  private pollTimer: any = null;

  constructor(props: Props) {
    super(props);
    this.state = {
      running: false,
      port: 28283,
      token: "",
      selectedAddress: "127.0.0.1",
      interfaces: [],
      connectionUrl: "",
      isLoading: true,
      copied: false,
      copiedToken: false,
    };
  }

  async componentDidMount() {
    await this.fetchStatus();
    // Auto-poll network interfaces every 3 seconds while dialog is open to detect Wi-Fi/Hotspot changes
    this.pollTimer = setInterval(() => {
      this.fetchStatus(true);
    }, 3000);
  }

  componentWillUnmount() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  fetchStatus = async (silent = false) => {
    try {
      const electronAPI = (window as any).electronAPI;
      if (electronAPI && typeof electronAPI.invoke === "function") {
        const status: MobileServerStatus = await electronAPI.invoke(
          "mobile-server-status"
        );
        if (status) {
          const interfaces = status.interfaces || [];
          let selectedAddress = status.selectedAddress;

          // Double check that selectedAddress exists in currently available interfaces
          const isSelectedValid = interfaces.some((i) => i.address === selectedAddress);
          if (!isSelectedValid && interfaces.length > 0) {
            selectedAddress = interfaces[0].address;
            electronAPI
              .invoke("mobile-server-select-address", selectedAddress)
              .catch(() => {});
          }

          this.setState({
            running: status.running,
            port: status.port,
            token: status.token,
            selectedAddress,
            interfaces,
            connectionUrl: status.connectionUrl,
            isLoading: false,
          });
        }
      }
    } catch (err: any) {
      console.error("Failed to get mobile server status:", err);
      if (!silent) {
        this.setState({ isLoading: false });
      }
    }
  };

  handleRefreshNetwork = async () => {
    await this.fetchStatus(false);
    toast.success(this.props.t("Network adapters refreshed") || "网卡列表已刷新");
  };

  handleToggle = async () => {
    try {
      const electronAPI = (window as any).electronAPI;
      if (!electronAPI) return;
      const nextRunning = !this.state.running;
      this.setState({ isLoading: true });
      const status: MobileServerStatus = await electronAPI.invoke(
        "mobile-server-toggle",
        nextRunning
      );
      if (status) {
        this.setState({
          running: status.running,
          port: status.port,
          token: status.token,
          selectedAddress: status.selectedAddress,
          interfaces: status.interfaces || [],
          connectionUrl: status.connectionUrl,
          isLoading: false,
        });
        toast.success(
          nextRunning
            ? this.props.t("Mobile companion server started")
            : this.props.t("Mobile companion server stopped")
        );
      }
    } catch (err: any) {
      console.error("Failed to toggle mobile server:", err);
      toast.error(err.message || "Operation failed");
      this.setState({ isLoading: false });
    }
  };

  handleAddressChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const address = e.target.value;
    try {
      const electronAPI = (window as any).electronAPI;
      if (!electronAPI) return;
      const status: MobileServerStatus = await electronAPI.invoke(
        "mobile-server-select-address",
        address
      );
      if (status) {
        this.setState({
          selectedAddress: status.selectedAddress,
          connectionUrl: status.connectionUrl,
        });
      }
    } catch (err: any) {
      console.error("Failed to switch address:", err);
    }
  };

  handleResetToken = async () => {
    const confirmMsg = this.props.t(
      "Reset token will disconnect any previously paired mobile devices. Continue?"
    );
    if (!window.confirm(confirmMsg)) return;

    try {
      const electronAPI = (window as any).electronAPI;
      if (!electronAPI) return;
      this.setState({ isLoading: true });
      const status: MobileServerStatus = await electronAPI.invoke(
        "mobile-server-reset-token"
      );
      if (status) {
        this.setState({
          token: status.token,
          connectionUrl: status.connectionUrl,
          isLoading: false,
        });
        toast.success(this.props.t("Token reset successfully"));
      }
    } catch (err: any) {
      console.error("Failed to reset token:", err);
      toast.error(err.message || "Failed to reset token");
      this.setState({ isLoading: false });
    }
  };

  handleCopy = () => {
    if (!this.state.connectionUrl) return;
    const success = copy(this.state.connectionUrl);
    if (success) {
      this.setState({ copied: true });
      toast.success(this.props.t("Link copied to clipboard"));
      setTimeout(() => this.setState({ copied: false }), 2000);
    }
  };

  handleCopyToken = () => {
    if (!this.state.token) return;
    const success = copy(this.state.token);
    if (success) {
      this.setState({ copiedToken: true });
      toast.success(this.props.t("Token copied to clipboard"));
      setTimeout(() => this.setState({ copiedToken: false }), 2000);
    }
  };

  render() {
    const { t } = this.props;
    const { running, connectionUrl, interfaces, selectedAddress, copied, isLoading } =
      this.state;

    return (
      <div className="mobile-pairing-overlay" onClick={this.props.onClose}>
        <div
          className="mobile-pairing-modal"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mobile-pairing-header">
            <div className="mobile-pairing-title">
              <span className="icon-phone" style={{ fontSize: "20px" }}></span>
              <Trans>Mobile LAN Link</Trans>
            </div>
            <button
              className="mobile-pairing-close"
              onClick={this.props.onClose}
              title={t("Close")}
            >
              ✕
            </button>
          </div>

          {/* Status & Service Switch */}
          <div className="mobile-pairing-status-row">
            <span className="mobile-pairing-status-label">
              <Trans>Service Status</Trans>
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span
                className={`mobile-pairing-status-badge ${
                  running ? "status-running" : "status-stopped"
                }`}
              >
                {running ? t("Running") : t("Stopped")}
              </span>
              <button
                className="mobile-pairing-btn-toggle"
                onClick={this.handleToggle}
                disabled={isLoading}
              >
                {running ? t("Stop") : t("Start")}
              </button>
            </div>
          </div>

          {running ? (
            <>
              {/* Network Adapter Selector */}
              <div className="mobile-pairing-field">
                <div className="mobile-pairing-field-header">
                  <label className="mobile-pairing-field-label">
                    <Trans>Network Adapter</Trans>
                  </label>
                  <button
                    type="button"
                    className="mobile-pairing-btn-refresh"
                    onClick={this.handleRefreshNetwork}
                    title={t("Refresh Network Adapters")}
                  >
                    <span style={{ marginRight: "4px" }}>↻</span>
                    <Trans>Refresh</Trans>
                  </button>
                </div>
                <select
                  className="mobile-pairing-select"
                  value={
                    interfaces.some((item) => item.address === selectedAddress)
                      ? selectedAddress
                      : interfaces[0]?.address || ""
                  }
                  onChange={this.handleAddressChange}
                >
                  {interfaces.map((item, idx) => (
                    <option key={`${item.name}-${item.address}-${idx}`} value={item.address}>
                      {item.name} ({item.address}){item.isVirtual ? ` [${t("Virtual")}]` : ""}
                    </option>
                  ))}
                </select>
                {selectedAddress && selectedAddress.startsWith("172.20.10.") && (
                  <div className="mobile-pairing-hotspot-hint">
                    <span className="mobile-pairing-hotspot-badge">📱 手机热点</span>
                    <span>已检测到 iOS 手机热点网段，请手机扫码直连</span>
                  </div>
                )}
              </div>

              {/* Dynamic QR Code */}
              <div className="mobile-pairing-qr-box">
                <div
                  className="mobile-pairing-qr-wrapper"
                  dangerouslySetInnerHTML={{
                    __html: generateQrSvg(connectionUrl || "https://koodo.app", 200),
                  }}
                />
                <span className="mobile-pairing-qr-tip">
                  <Trans>Scan QR code with phone camera or browser to start reading</Trans>
                </span>
              </div>

              {/* Direct Link & Copy */}
              <div className="mobile-pairing-field">
                <label className="mobile-pairing-field-label">
                  <Trans>Direct Link</Trans>
                </label>
                <div className="mobile-pairing-url-row">
                  <input
                    type="text"
                    readOnly
                    className="mobile-pairing-url-input"
                    value={connectionUrl}
                    onClick={(e) => (e.target as HTMLInputElement).select()}
                  />
                  <button className="mobile-pairing-btn-copy" onClick={this.handleCopy}>
                    {copied ? t("Copied") : t("Copy Link")}
                  </button>
                </div>
              </div>

              {/* Pairing Token & Copy */}
              <div className="mobile-pairing-field">
                <label className="mobile-pairing-field-label">
                  <Trans>Pairing Token</Trans>
                </label>
                <div className="mobile-pairing-url-row">
                  <input
                    type="text"
                    readOnly
                    className="mobile-pairing-url-input"
                    value={this.state.token}
                    style={{ fontFamily: "monospace" }}
                    onClick={(e) => (e.target as HTMLInputElement).select()}
                  />
                  <button
                    className="mobile-pairing-btn-copy"
                    onClick={this.handleCopyToken}
                  >
                    {this.state.copiedToken ? t("Copied") : t("Copy Token")}
                  </button>
                </div>
                <span
                  className="mobile-pairing-qr-tip"
                  style={{ marginTop: "4px", fontSize: "11px", color: "#6b7280" }}
                >
                  <Trans>Enter this token if your mobile browser asks for pairing key</Trans>
                </span>
              </div>
            </>
          ) : (
            <div style={{ textAlign: "center", padding: "40px 0", color: "#9ca3af" }}>
              <p>
                <Trans>Service is stopped. Click Start to enable local network reading.</Trans>
              </p>
            </div>
          )}

          {/* Footer Actions */}
          <div className="mobile-pairing-footer">
            <button
              className="mobile-pairing-btn-reset"
              onClick={this.handleResetToken}
              disabled={isLoading}
              title={t("Reset pairing token")}
            >
              <Trans>Reset Token</Trans>
            </button>
            <button className="mobile-pairing-btn-toggle" onClick={this.props.onClose}>
              <Trans>Close</Trans>
            </button>
          </div>
        </div>
      </div>
    );
  }
}

export default withTranslation()(MobilePairingDialog);
