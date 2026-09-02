import { RouteComponentProps } from "react-router";

export interface SidebarProps extends RouteComponentProps<any> {
  mode: string;
  isCollapsed: boolean;
  shelfTitle: string;
  isAuthed: boolean;
  isOpenSortShelfDialog: boolean;
  handleMode: (mode: string) => void;
  handleSortShelfDialog: (isOpenSortShelfDialog: boolean) => void;
  handleJmcomicDialog: (isOpen: boolean) => void;
  handlePicaDialog: (isOpen: boolean) => void;
  handleSearch: (isSearch: boolean) => void;
  handleCollapse: (isCollapsed: boolean) => void;
  handleSortDisplay: (isSortDisplay: boolean) => void;
  handleSelectBook: (isSelectBook: boolean) => void;
  handleSelectedBooks?: (selectedBooks: string[]) => void;
  handleShelf: (shelfTitle: string) => void;
  handleFetchBooks: () => void;
  t: (title: string) => string;
}

export interface SidebarState {
  mode: string;
  hoverMode: string;
  hoverShelfTitle: string;
  isCollapsed: boolean;
  isCollpaseShelf: boolean;
  isOnlineComicsExpanded: boolean;
  hoverSubMode: string;
  shelfTitle: string;
  newShelfName: string;
  isOpenDelete: boolean;
  isCreateShelf: boolean;
  dropTargetShelf: string;
}
