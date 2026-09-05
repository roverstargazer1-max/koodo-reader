import { connect } from "react-redux";
import { handleFilterConfig } from "../../store/actions";
import { stateType } from "../../store";
import ActiveFilterBar from "./component";
import { withTranslation } from "react-i18next";

const mapStateToProps = (state: stateType) => {
  return {
    filterConfig: state.manager.filterConfig,
  };
};

const actionCreator = {
  handleFilterConfig,
};

export default connect(
  mapStateToProps,
  actionCreator
)(withTranslation()(ActiveFilterBar as any) as any);
