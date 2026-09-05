import { connect } from "react-redux";
import {
  handleFilterDisplay,
  handleFilterConfig,
} from "../../../store/actions";
import { stateType } from "../../../store";
import FilterDialog from "./component";
import { withTranslation } from "react-i18next";

const mapStateToProps = (state: stateType) => {
  return {
    books: state.manager.books,
    filterConfig: state.manager.filterConfig,
    isFilterDisplay: state.manager.isFilterDisplay,
    isCollapsed: state.sidebar.isCollapsed,
  };
};

const actionCreator = {
  handleFilterDisplay,
  handleFilterConfig,
};

export default connect(
  mapStateToProps,
  actionCreator
)(withTranslation()(FilterDialog as any) as any);
