import React from "react";
import "./popupTrans.css";
import { PopupTransProps, PopupTransState } from "./interface";
import {
  ConfigService,
  KookitConfig,
  HighlightUtil,
  NoteSyncManager,
} from "../../../assets/lib/kookit-extra-browser.min";
import DatabaseService from "../../../utils/storage/databaseService";
import Note from "../../../models/Note";
import copy from "copy-text-to-clipboard";
import axios from "axios";
import { Trans } from "react-i18next";
import toast from "react-hot-toast";
import { getDefaultTransTarget, openExternalUrl } from "../../../utils/common";
import { getTransStream } from "../../../utils/request/reader";
import { chatStream } from "../../../utils/request/common";
import { getIframeDoc } from "../../../utils/reader/docUtil";
import { getBuiltinTranslation } from "../../../utils/plugins/rendererRegistry";
import type { PluginConfig } from "../../../utils/plugins/types";
import {
  executeCustomTranslation,
  isCustomRendererPlugin,
} from "../../../utils/plugins/customPlugin";

declare var window: any;

class PopupTrans extends React.Component<PopupTransProps, PopupTransState> {
  private textAccumulator: string = "";
  private updateInterval: ReturnType<typeof setInterval> | null = null;

  constructor(props: PopupTransProps) {
    super(props);
    this.state = {
      translatedText: "",
      originalText: "",
      transService: ConfigService.getReaderConfig("transService") || "",
      transTarget: ConfigService.getReaderConfig("transTarget"),
      transSource: ConfigService.getReaderConfig("transSource"),
      isAddNew: false,
      isFinishOutput: false,
      isAiWaiting: false,
      isSavedAsNote: false,
      savedNoteKey: "",
      isEditing: false,
    };
  }

  private startUpdateInterval() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }
    this.updateInterval = setInterval(() => {
      if (this.textAccumulator) {
        this.setState({ translatedText: this.textAccumulator });
      }
    }, 150);
  }

  private stopUpdateInterval() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    if (this.textAccumulator) {
      this.setState({ translatedText: this.textAccumulator });
    }
  }
  async componentDidMount() {
    let originalText = this.props.originalText.replace(/(\r\n|\n|\r)/gm, "");
    this.setState({ originalText: originalText });

    // Check if current text is already saved as a note
    if (this.props.noteKey) {
      let existingNote: Note = await DatabaseService.getRecord(
        this.props.noteKey,
        "notes"
      );
      if (existingNote) {
        this.setState({
          isSavedAsNote: true,
          savedNoteKey: existingNote.key,
          translatedText: existingNote.notes || "",
        });
      }
    } else if (this.props.currentBook) {
      let allNotes: Note[] = await DatabaseService.getRecordsByBookKey(
        this.props.currentBook.key,
        "notes"
      );
      if (allNotes && allNotes.length > 0) {
        let matched = allNotes.find(
          (n) =>
            n.text === originalText &&
            n.tag &&
            (n.tag.includes("翻译") || n.tag.includes("Translation"))
        );
        if (matched) {
          this.setState({
            isSavedAsNote: true,
            savedNoteKey: matched.key,
            translatedText: matched.notes || "",
          });
        }
      }
    }

    if (!this.state.transService) {
      let pluginList = this.props.plugins.filter(
        (item) =>
          item.type === "translation" && !item.key.startsWith("official-ai-")
      );
      if (pluginList.length > 0) {
        this.setState({
          transService: pluginList[0].key,
        });
        ConfigService.setReaderConfig("transService", pluginList[0].key);
        await new Promise((resolve) => setTimeout(resolve, 100));
      } else if (this.props.isAuthed) {
        this.setState({
          transService: "official-ai-trans-plugin",
          isAddNew: false,
        });
        ConfigService.setReaderConfig(
          "transService",
          "official-ai-trans-plugin"
        );
      } else {
        this.setState({
          isAddNew: true,
        });
      }
    }

    this.handleTrans(originalText);
  }
  UNSAFE_componentWillReceiveProps(nextProps: PopupTransProps) {
    if (nextProps.originalText !== this.props.originalText) {
      let originalText = nextProps.originalText.replace(/(\r\n|\n|\r)/gm, "");
      this.setState({
        originalText: originalText,
        translatedText: "",
        isSavedAsNote: false,
        savedNoteKey: "",
      });
      this.handleTrans(originalText);
    }
  }

  handleTrans = async (text: string) => {
    if (
      ConfigService.getReaderConfig("transService") &&
      ConfigService.getReaderConfig("transService") !==
        "official-ai-trans-plugin" &&
      ConfigService.getReaderConfig("transService") !== "custom-ai-trans-plugin"
    ) {
      let plugin = this.props.plugins.find(
        (item) => item.key === ConfigService.getReaderConfig("transService")
      );
      if (!plugin) {
        return;
      }
      const builtinTranslate = getBuiltinTranslation(plugin.key);
      const translate = builtinTranslate
        ? builtinTranslate
        : isCustomRendererPlugin(plugin)
          ? executeCustomTranslation(plugin)
          : undefined;
      if (!translate) return;
      translate(
        text,
        ConfigService.getReaderConfig("transSource") || "",
        ConfigService.getReaderConfig("transTarget") ||
          getDefaultTransTarget(plugin.langList),
        axios,
        plugin.config as PluginConfig
      )
        .then((res: string) => {
          if (res.startsWith("https://")) {
            openExternalUrl(res, true, "trans");
            let docs = getIframeDoc(this.props.currentBook.format);
            for (let i = 0; i < docs.length; i++) {
              let doc = docs[i];
              if (!doc) continue;
              doc.getSelection()?.empty();
            }
          } else {
            this.setState(
              {
                translatedText: res,
              },
              () => {
                this.checkAutoSave();
              }
            );
          }
        })
        .catch((err) => {
          toast.error(
            this.props.t("Translation failed") +
              ": " +
              (err instanceof Error ? err.message : String(err))
          );
          console.error(err);
        });
    } else if (
      ConfigService.getReaderConfig("transService") === "custom-ai-trans-plugin"
    ) {
      this.setState({
        transService: "custom-ai-trans-plugin",
        isAddNew: false,
      });
      let plugin = this.props.plugins.find(
        (item) => item.key === "custom-ai-trans-plugin"
      );
      if (!plugin) {
        return;
      }
      let targetLang =
        ConfigService.getReaderConfig("transTarget") ||
        getDefaultTransTarget(plugin.langList);
      if (targetLang === "Traditional Chinese") {
        targetLang = "繁体中文";
      }
      let systemPrompt =
        ConfigService.getReaderConfig("aiTranslatePrompt") ||
        KookitConfig.DefaultPrompts.aiTranslate;
      systemPrompt = systemPrompt.replace(
        "{from}",
        ConfigService.getReaderConfig("transSource") || "Automatic"
      );
      systemPrompt = systemPrompt.replace("{to}", targetLang);
      systemPrompt = systemPrompt.replace("{text}", text);
      let config: any = plugin.config || {};
      this.textAccumulator = "";
      this.setState({ isAiWaiting: true });
      this.startUpdateInterval();
      await chatStream(
        config.endpoint,
        config.providerId,
        config.apiKey,
        config.modelId,
        systemPrompt,
        [],
        (result) => {
          if (result && result.done) {
            return;
          }
          if (result && result.text) {
            if (!this.textAccumulator) {
              this.setState({ isAiWaiting: false });
            }
            this.textAccumulator += result.text;
          }
        }
      );
      this.stopUpdateInterval();
      this.textAccumulator = "";
      this.setState({ isFinishOutput: true, isAiWaiting: false }, () => {
        this.checkAutoSave();
      });
    } else if (
      this.props.isAuthed &&
      ConfigService.getReaderConfig("isDisableAI") !== "yes"
    ) {
      this.setState({
        transService: "official-ai-trans-plugin",
        isAddNew: false,
      });
      let plugin = this.props.plugins.find(
        (item) => item.key === "official-ai-trans-plugin"
      );
      if (!plugin) {
        return;
      }
      let targetLang =
        ConfigService.getReaderConfig("transTarget") ||
        getDefaultTransTarget(plugin.langList);
      if (targetLang === "Traditional Chinese") {
        targetLang = "繁体中文";
      }
      this.textAccumulator = "";
      this.startUpdateInterval();
      await getTransStream(
        text,
        ConfigService.getReaderConfig("transSource") || "Automatic",
        ConfigService.getReaderConfig("transTarget") ||
          getDefaultTransTarget(plugin.langList),
        (result) => {
          if (result && result.done) {
            return;
          }
          if (result && result.text) {
            this.textAccumulator += result.text;
          }
        }
      );
      this.stopUpdateInterval();
      this.textAccumulator = "";
      this.setState({ isFinishOutput: true }, () => {
        this.checkAutoSave();
      });
    }
  };

  checkAutoSave = () => {
    if (
      ConfigService.getReaderConfig("isAutoSaveTransNote") === "yes" &&
      this.state.translatedText &&
      !this.state.isSavedAsNote
    ) {
      this.handleSaveToNote(true);
    }
  };

  handleCopyTrans = () => {
    if (!this.state.translatedText) return;
    copy(this.state.translatedText);
    toast.success(this.props.t("Copying successful"));
  };

  handleNoteClick = (event: Event) => {
    this.props.handleNoteKey((event.target as any).dataset.key);
    this.props.handleMenuMode("note");
    this.props.handleOpenMenu(true);
  };

  handleSaveToNote = async (silent = false) => {
    const textToSave = this.state.translatedText.trim();
    if (!textToSave) {
      if (!silent)
        toast.error(this.props.t("Please wait for translation to complete"));
      return;
    }

    if (this.state.isSavedAsNote && this.state.savedNoteKey) {
      let existingNote: Note = await DatabaseService.getRecord(
        this.state.savedNoteKey,
        "notes"
      );
      if (existingNote) {
        existingNote.notes = textToSave;
        if (!existingNote.tag) existingNote.tag = [];
        if (!existingNote.tag.includes("翻译")) {
          existingNote.tag.push("翻译");
        }
        await DatabaseService.updateRecord(existingNote, "notes");
        if (this.props.htmlBook && this.props.htmlBook.rendition) {
          this.props.htmlBook.rendition.removeOneNote(
            existingNote.key,
            this.props.chapterDocIndex
          );
          await this.props.htmlBook.rendition.createOneNote(
            { ...existingNote, notes: "" },
            this.handleNoteClick
          );
        }
        let noteSyncManager = new NoteSyncManager(
          DatabaseService,
          ConfigService,
          window.electronAPI?.fs,
          window.electronAPI?.path
        );
        noteSyncManager.syncNote(existingNote, this.props.currentBook.key);
        this.props.handleFetchNotes();
        if (!silent) toast.success(this.props.t("Note updated successfully"));
        return;
      }
    }

    let bookKey = this.props.currentBook?.key || "";
    let cfi = JSON.stringify(
      ConfigService.getObjectConfig(bookKey, "recordLocation", {})
    );
    if (
      this.props.currentBook?.format === "PDF" &&
      !ConfigService.getAllListConfig("convertPDFBooks").includes(bookKey)
    ) {
      let bookLocation = this.props.htmlBook?.rendition?.getPositionByChapter(
        this.props.chapterDocIndex
      );
      cfi = JSON.stringify(bookLocation);
    }

    let range = "{}";
    if (this.props.htmlBook?.rendition?.getHighlightCoords) {
      try {
        range = JSON.stringify(
          await this.props.htmlBook.rendition.getHighlightCoords(
            this.props.chapterDocIndex
          )
        );
      } catch (e) {
        console.error(e);
      }
    }

    let percentage =
      ConfigService.getObjectConfig(bookKey, "recordLocation", {}).percentage ||
      "0";

    let transStyle =
      ConfigService.getReaderConfig("transHighlightStyle") || "underline";
    let transColor =
      ConfigService.getReaderConfig("transHighlightColor") || "#4A90E2";
    let color = `${transStyle}-${transColor}`;
    let tag = ["翻译"];

    let note = new Note(
      bookKey,
      this.props.chapter,
      this.props.chapterDocIndex,
      this.state.originalText,
      cfi,
      range,
      textToSave,
      percentage,
      color,
      tag
    );

    await DatabaseService.saveRecord(note, "notes");
    this.setState({ isSavedAsNote: true, savedNoteKey: note.key });
    this.props.handleFetchNotes();

    if (this.props.htmlBook && this.props.htmlBook.rendition) {
      await this.props.htmlBook.rendition.createOneNote(
        { ...note, notes: "" },
        this.handleNoteClick
      );
    }
    let noteSyncManager = new NoteSyncManager(
      DatabaseService,
      ConfigService,
      window.electronAPI?.fs,
      window.electronAPI?.path
    );
    noteSyncManager.syncNote(note, bookKey);
    if (!silent) toast.success(this.props.t("Saved as note successfully"));
  };
  handleChangeService(target: string) {
    this.setState({ transService: target }, () => {
      ConfigService.setReaderConfig("transService", target);
      let plugin = this.props.plugins.find(
        (item) => item.key === this.state.transService
      );
      if (!plugin) {
        return;
      }
      let autoValue = plugin.autoValue;
      this.setState(
        {
          transSource: autoValue,
          transTarget: getDefaultTransTarget(plugin.langList),
        },
        () => {
          ConfigService.setReaderConfig(
            "transTarget",
            getDefaultTransTarget(plugin?.langList)
          );
          ConfigService.setReaderConfig("transSource", autoValue);
          this.handleTrans(
            this.props.originalText.replace(/(\r\n|\n|\r)/gm, "")
          );
        }
      );
    });
  }
  render() {
    const renderNoteEditor = () => {
      return (
        <div className="trans-container">
          <div className="trans-service-selector-container">
            <div
              className="trans-service-selector-inactive"
              onClick={() => {
                this.props.handleOpenMenu(false);
                this.props.handleMenuMode("");
                this.props.handleSetting(true);
                this.props.handleSettingMode("plugins");
              }}
            >
              <span className="icon-add trans-add-icon"></span>
              <Trans>Add</Trans>
            </div>
            {this.props.plugins
              .filter((item) => item.type === "translation")
              .map((item) => {
                return (
                  <div
                    className={
                      this.state.transService === item.key
                        ? "trans-service-selector"
                        : "trans-service-selector-inactive"
                    }
                    onClick={() => {
                      this.setState({ isAddNew: false });
                      this.handleChangeService(item.key);
                    }}
                  >
                    <span className={`icon-${item.icon} trans-icon`}></span>
                    {this.props.t(item.displayName)}
                  </div>
                );
              })}
          </div>
          {this.state.isAddNew && (
            <div
              style={{
                marginTop: "50px",
                textAlign: "center",
                fontSize: "17px",
                color: "#f16464",
              }}
            >
              <span
                style={{
                  textDecoration: "underline",
                  cursor: "pointer",
                  textAlign: "center",
                }}
                onClick={() => {
                  this.props.handleOpenMenu(false);
                  this.props.handleMenuMode("");
                  this.props.handleSetting(true);
                  this.props.handleSettingMode("plugins");
                }}
              >
                <Trans>Add new plugin</Trans>
              </span>
            </div>
          )}
          {!this.state.isAddNew && (
            <>
              <div
                className="trans-box"
                style={
                  this.props.isDockedRight
                    ? { flexDirection: "column", height: "calc(100% - 110px)" }
                    : { height: "calc(100% - 46px)" }
                }
              >
                <div
                  className="original-text-box"
                  style={
                    this.props.isDockedRight
                      ? {
                          flex: 1,
                          minHeight: 0,
                          borderRight: "1px solid rgba(0,0,0,0.05)",
                          borderBottom: "1px solid rgba(0,0,0,0.05)",
                          borderBottomLeftRadius: 0,
                          borderTopRightRadius: "7px",
                        }
                      : undefined
                  }
                >
                  <div className="original-lang-box">
                    <select
                      className="original-lang-selector"
                      style={{ maxWidth: "120px", margin: 0 }}
                      value={ConfigService.getReaderConfig("transSource")}
                      onChange={(
                        event: React.ChangeEvent<HTMLSelectElement>
                      ) => {
                        let targetLang = event.target.value;
                        ConfigService.setReaderConfig(
                          "transSource",
                          targetLang
                        );
                        this.handleTrans(
                          this.props.originalText.replace(/(\r\n|\n|\r)/gm, "")
                        );
                        this.forceUpdate();
                      }}
                    >
                      {this.props.plugins.find(
                        (item) => item.key === this.state.transService
                      )?.langList &&
                        Object.keys(
                          this.props.plugins.find(
                            (item) => item.key === this.state.transService
                          )?.langList as any
                        ).map((item, index) => {
                          return (
                            <option
                              value={item}
                              key={index}
                              className="add-dialog-shelf-list-option"
                            >
                              {this.props.t(
                                Object.values(
                                  this.props.plugins.find(
                                    (item) =>
                                      item.key === this.state.transService
                                  )?.langList as any[]
                                )[index]
                              )}
                            </option>
                          );
                        })}
                    </select>
                  </div>
                  <div className="original-text">{this.state.originalText}</div>
                </div>
                <div
                  className="trans-text-box"
                  style={
                    this.props.isDockedRight
                      ? { flex: 1, minHeight: 0 }
                      : undefined
                  }
                >
                  <div className="trans-lang-box">
                    <select
                      className="trans-lang-selector"
                      style={{ maxWidth: "120px", margin: 0 }}
                      value={
                        ConfigService.getReaderConfig("transTarget") ||
                        getDefaultTransTarget(
                          this.props.plugins.find(
                            (item) => item.key === this.state.transService
                          )?.langList
                        )
                      }
                      onChange={(
                        event: React.ChangeEvent<HTMLSelectElement>
                      ) => {
                        let targetLang = event.target.value;
                        ConfigService.setReaderConfig(
                          "transTarget",
                          targetLang
                        );
                        this.handleTrans(
                          this.props.originalText.replace(/(\r\n|\n|\r)/gm, "")
                        );
                        this.forceUpdate();
                      }}
                    >
                      {this.props.plugins.find(
                        (item) => item.key === this.state.transService
                      )?.langList &&
                        Object.keys(
                          this.props.plugins.find(
                            (item) => item.key === this.state.transService
                          )?.langList as any
                        ).map((item, index) => {
                          return (
                            <option
                              value={item}
                              key={index}
                              className="add-dialog-shelf-list-option"
                            >
                              {this.props.t(
                                Object.values(
                                  this.props.plugins.find(
                                    (item) =>
                                      item.key === this.state.transService
                                  )?.langList as any[]
                                )[index]
                              )}
                            </option>
                          );
                        })}
                    </select>
                  </div>
                  <div className="trans-text">
                    {this.state.isAiWaiting && !this.state.translatedText ? (
                      <div className="dict-ai-answer-waiting">
                        <span className="icon-loading popup-assistant-loading"></span>
                        <span>
                          {this.props.t("Thinking, please wait...")}
                        </span>
                      </div>
                    ) : (
                      <textarea
                        className="trans-result-textarea"
                        value={this.state.translatedText}
                        onChange={(e) =>
                          this.setState({
                            translatedText: e.target.value,
                            isSavedAsNote: false,
                          })
                        }
                        placeholder={this.props.t("Translation result...")}
                      />
                    )}
                    {this.state.transService.includes("ai-trans") &&
                      this.state.isFinishOutput && (
                        <p
                          className="dict-learn-more"
                          style={{ color: "#f16464" }}
                        >
                          {this.props.t("Generated with AI")}
                        </p>
                      )}
                  </div>
                </div>
              </div>

              <div className="trans-action-bar">
                <div className="trans-action-left">
                  {this.state.isSavedAsNote ? (
                    <span className="trans-saved-badge">
                      <span className="icon-check trans-check-icon"></span>
                      <Trans>Saved as note</Trans>
                    </span>
                  ) : null}
                </div>
                <div className="trans-action-right">
                  <button
                    className="trans-action-btn"
                    onClick={this.handleCopyTrans}
                    disabled={!this.state.translatedText}
                    title={this.props.t("Copy translation")}
                  >
                    <span className="icon-copy trans-btn-icon"></span>
                    <Trans>Copy</Trans>
                  </button>
                  <button
                    className={`trans-action-btn trans-save-btn ${
                      this.state.isSavedAsNote ? "is-saved" : ""
                    }`}
                    onClick={() => this.handleSaveToNote(false)}
                    disabled={
                      !this.state.translatedText || this.state.isAiWaiting
                    }
                    title={
                      this.state.isSavedAsNote
                        ? this.props.t("Update note")
                        : this.props.t("Save as note")
                    }
                  >
                    <span className="icon-note trans-btn-icon"></span>
                    {this.state.isSavedAsNote ? (
                      <Trans>Update note</Trans>
                    ) : (
                      <Trans>Save as note</Trans>
                    )}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      );
    };

    return renderNoteEditor();
  }
}
export default PopupTrans;
