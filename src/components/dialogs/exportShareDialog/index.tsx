import { handleExportShareDialog } from "../../../store/actions";
import { connect } from "react-redux";
import { withTranslation } from "react-i18next";
import { stateType } from "../../../store";
import ExportShareDialog from "./component";
import { withRouter } from "react-router-dom";

const mapStateToProps = (state: stateType) => {
  return {
    isOpenExportShareDialog: state.backupPage.isOpenExportShareDialog,
    exportShareData: state.backupPage.exportShareData,
  };
};

const actionCreator = {
  handleExportShareDialog,
};

export default connect(
  mapStateToProps,
  actionCreator
)(withTranslation()(withRouter(ExportShareDialog as any) as any) as any);
