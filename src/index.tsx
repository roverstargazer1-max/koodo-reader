import React from "react";
import ReactDOM from "react-dom";
import "./assets/styles/reset.css";
import "./assets/styles/global.css";
import "./assets/styles/style.css";
import { Provider } from "react-redux";
import "./i18n";
import store from "./store";
import Router from "./router/index";
import StyleUtil from "./utils/reader/styleUtil";
import {
  initSystemFont,
  initTheme,
  applyCustomSystemCSS,
  applyAppBackgroundImage,
} from "./utils/reader/launchUtil";
import { migrateConfig } from "./utils/common";
import { initProgressSyncBridge } from "./utils/sync/progressSyncBridge";
initTheme();
initSystemFont();
migrateConfig();
applyCustomSystemCSS();
applyAppBackgroundImage();
try {
  initProgressSyncBridge(store);
} catch (e) {
  console.warn("Failed to initialize progress sync bridge:", e);
}
const container = document.getElementById("root")!;
ReactDOM.render(
  <Provider store={store}>
    <Router />
  </Provider>,
  container
);
StyleUtil.applyTheme();
