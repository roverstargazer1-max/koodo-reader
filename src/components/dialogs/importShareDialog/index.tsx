import {
  handleImportShareDialog,
  handleFetchBooks,
  handleFetchNotes,
  handleFetchBookmarks,
  handleMode,
  handleShelf,
} from "../../../store/actions";
import { connect } from "react-redux";
import { withTranslation } from "react-i18next";
import { stateType } from "../../../store";
import ImportShareDialog from "./component";
import { withRouter } from "react-router-dom";

const mapStateToProps = (state: stateType) => {
  return {
    isOpenImportShareDialog: state.backupPage.isOpenImportShareDialog,
    importShareData: state.backupPage.importShareData,
  };
};

const actionCreator = {
  handleImportShareDialog,
  handleFetchBooks,
  handleFetchNotes,
  handleFetchBookmarks,
  handleMode,
  handleShelf,
};

export default connect(
  mapStateToProps,
  actionCreator
)(withTranslation()(withRouter(ImportShareDialog as any) as any) as any);
