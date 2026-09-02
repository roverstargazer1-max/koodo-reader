import { connect } from "react-redux";
import { withTranslation } from "react-i18next";
import { withRouter } from "react-router-dom";
import { stateType } from "../../../store";
import { handlePicaDialog, handleFetchBooks } from "../../../store/actions";
import PicaDialog from "./component";

const mapStateToProps = (state: stateType) => {
  return {
    books: state.manager.books,
    importBookFunc: state.book.importBookFunc,
  };
};

const actionCreator = {
  handlePicaDialog,
  handleFetchBooks,
};

export default connect(
  mapStateToProps,
  actionCreator
)(withTranslation()(withRouter(PicaDialog as any) as any) as any);
