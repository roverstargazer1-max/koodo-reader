import BookModel from "../../../models/Book";
import { RouteComponentProps } from "react-router";
export interface BookListProps extends RouteComponentProps<any> {
  books: BookModel[];
  mode: string;
  shelfTitle: string;
  searchResults: number[];
  isSearch: boolean;
  isCollapsed: boolean;
  currentPage: number;
  totalPage: number;
  isSelectBook: boolean;
  viewMode: string;
  selectedBooks: string[];
  isOpenDeleteDialog?: boolean;
  filterConfig?: any;
  handleFilterConfig?: (config: any) => void;

  bookSortCode: { sort: number; order: number };
  noteSortCode: { sort: number; order: number };
  handleAddDialog: (isShow: boolean) => void;
  handleMode: (mode: string) => void;
  handleFetchBooks: () => void;
  handleShelf: (shelfTitle: string) => void;
  handleDeleteDialog: (isShow: boolean) => void;
  handleLoadMore: (isLoadMore: boolean) => void;
  handleSelectBook: (isSelectBook: boolean) => void;
  handleSelectedBooks: (selectedBooks: string[]) => void;
  handleExportShareDialog: (isOpen: boolean, data?: any) => void;
  t: (title: string) => string;
}
export interface SelectionBox {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}
export interface BookListState {
  favoriteBooks: number;
  isHideShelfBook: boolean;
  displayedBooksCount: number;
  isLoadingMore: boolean;
  fullBooksData: BookModel[];
  cardScale: number;
  readingStatusFilter: string;
  selectionBox: SelectionBox | null;
}
