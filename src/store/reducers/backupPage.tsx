const initState = {
  isBackup: false,
  isOpenLocalFileDialog: false,
  isOpenTokenDialog: false,
  isOpenImportDialog: false,
  isOpenOPDSDialog: false,
  isOpenJmcomicDialog: false,
  isOpenPicaDialog: false,
  isOpenAutoImportDialog: false,
  isOpenSortShelfDialog: false,
  isOpenPopupOptionDialog: false,
  popupOptionUpdateIndex: 0,
  dataSourceList: [],
  loginOptionList: [],
  defaultSyncOption: "",
  isOpenExportShareDialog: false,
  exportShareData: null,
  isOpenImportShareDialog: false,
  importShareData: null,
};
export function backupPage(
  state = initState,
  action: { type: string; payload: any }
) {
  switch (action.type) {
    case "HANDLE_BACKUP":
      return {
        ...state,
        isBackup: action.payload,
      };
    case "HANDLE_LOCAL_FILE_DIALOG":
      return {
        ...state,
        isOpenLocalFileDialog: action.payload,
      };
    case "HANDLE_IMPORT_DIALOG":
      return {
        ...state,
        isOpenImportDialog: action.payload,
      };
    case "HANDLE_OPDS_DIALOG":
      return {
        ...state,
        isOpenOPDSDialog: action.payload,
      };
    case "HANDLE_JMCOMIC_DIALOG":
      return {
        ...state,
        isOpenJmcomicDialog: action.payload,
      };
    case "HANDLE_PICA_DIALOG":
      return {
        ...state,
        isOpenPicaDialog: action.payload,
      };
    case "HANDLE_AUTO_IMPORT_DIALOG":
      return {
        ...state,
        isOpenAutoImportDialog: action.payload,
      };
    case "HANDLE_SORT_SHELF_DIALOG":
      return {
        ...state,
        isOpenSortShelfDialog: action.payload,
      };
    case "HANDLE_POPUP_OPTION_DIALOG":
      return {
        ...state,
        isOpenPopupOptionDialog: action.payload,
      };
    case "HANDLE_POPUP_OPTION_UPDATE":
      return {
        ...state,
        popupOptionUpdateIndex: action.payload,
      };
    case "HANDLE_TOKEN_DIALOG":
      return {
        ...state,
        isOpenTokenDialog: action.payload,
      };
    case "HANDLE_LOGIN_OPTION":
      return {
        ...state,
        loginOptionList: action.payload,
      };
    case "SET_DATA_SOURCE":
      return {
        ...state,
        dataSourceList: action.payload,
      };
    case "HANDLE_DEFAULT_SYNC_OPTION":
      return {
        ...state,
        defaultSyncOption: action.payload,
      };
    case "HANDLE_EXPORT_SHARE_DIALOG":
      return {
        ...state,
        isOpenExportShareDialog: action.payload.mode,
        exportShareData: action.payload.data || null,
      };
    case "HANDLE_IMPORT_SHARE_DIALOG":
      return {
        ...state,
        isOpenImportShareDialog: action.payload.mode,
        importShareData: action.payload.data || null,
      };
    default:
      return state;
  }
}
