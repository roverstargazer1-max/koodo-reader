import { connect } from "react-redux";
import { withTranslation } from "react-i18next";
import { withRouter } from "react-router-dom";
import { stateType } from "../../../store";
import { handleJmcomicDialog, handleFetchBooks } from "../../../store/actions";
import JmcomicDialog from "./component";

const mapStateToProps = (state: stateType) => {
  return {
    importBookFunc: state.book.importBookFunc,
  };
};

const actionCreator = {
  handleJmcomicDialog,
  handleFetchBooks,
};

export default connect(
  mapStateToProps,
  actionCreator
)(withTranslation()(withRouter(JmcomicDialog as any) as any) as any);


