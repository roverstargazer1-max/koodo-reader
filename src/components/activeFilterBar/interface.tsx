import { FilterConfig } from "../../utils/filterUtil";

export interface ActiveFilterBarProps {
  filterConfig: FilterConfig;
  handleFilterConfig: (config: FilterConfig) => void;
  t: (key: string) => string;
}
