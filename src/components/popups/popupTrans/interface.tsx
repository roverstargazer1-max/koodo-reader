import Plugin from "../../../models/Plugin";
import BookModel from "../../../models/Book";
import HtmlBook from "../../../models/HtmlBook";
import { HighlightValue } from "../../../utils/common";

export interface PopupTransProps {
  originalText: string;
  plugins: Plugin[];
  currentBook: BookModel;
  isAuthed: boolean;
  isDockedRight: boolean;
  chapterDocIndex: number;
  chapter: string;
  noteKey: string;
  highlight: HighlightValue;
  htmlBook: HtmlBook;
  handleOpenMenu: (isOpenMenu: boolean) => void;
  handleMenuMode: (menu: string) => void;
  handleFetchPlugins: () => void;
  handleSetting: (isShow: boolean) => void;
  handleSettingMode: (settingMode: string) => void;
  handleNoteKey: (key: string) => void;
  handleFetchNotes: () => void;
  handleShowPopupNote: (isShowPopupNote: boolean) => void;
  t: (title: string) => string;
}
export interface PopupTransState {
  translatedText: string;
  originalText: string;
  transService: string;
  transTarget: string;
  transSource: string;
  isAddNew: boolean;
  isFinishOutput: boolean;
  isAiWaiting: boolean;
  isSavedAsNote: boolean;
  savedNoteKey: string;
  isEditing: boolean;
}

