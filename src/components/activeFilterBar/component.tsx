import React from "react";
import "./activeFilterBar.css";
import { ActiveFilterBarProps } from "./interface";
import {
  createEmptyFilterConfig,
  isFilterActive,
} from "../../utils/filterUtil";
import { Trans } from "react-i18next";
import {
  NOVEL_FORMATS,
  COMIC_FORMATS,
} from "../dialogs/filterDialog/component";

interface ChipItem {
  id: string;
  label: string;
  isExclude: boolean;
  onRemove: () => void;
}

class ActiveFilterBar extends React.Component<ActiveFilterBarProps> {
  handleRemoveShelf = (shelfName: string) => {
    const shelves = { ...this.props.filterConfig.shelves };
    delete shelves[shelfName];
    this.props.handleFilterConfig({
      ...this.props.filterConfig,
      shelves,
    });
  };

  handleRemoveUnclassified = () => {
    this.props.handleFilterConfig({
      ...this.props.filterConfig,
      unclassifiedShelf: undefined,
    });
  };

  handleRemoveReadingStatus = (status: string) => {
    const readingStatus = { ...this.props.filterConfig.readingStatus };
    delete readingStatus[status];
    this.props.handleFilterConfig({
      ...this.props.filterConfig,
      readingStatus,
    });
  };

  handleRemoveFormat = (format: string) => {
    const formats = { ...this.props.filterConfig.formats };
    delete formats[format];
    this.props.handleFilterConfig({
      ...this.props.filterConfig,
      formats,
    });
  };

  handleRemoveAuthor = (author: string) => {
    const authors = { ...this.props.filterConfig.authors };
    delete authors[author];
    this.props.handleFilterConfig({
      ...this.props.filterConfig,
      authors,
    });
  };

  handleRemoveFavorite = () => {
    this.props.handleFilterConfig({
      ...this.props.filterConfig,
      favorite: undefined,
    });
  };

  render() {
    const { filterConfig, t } = this.props;
    if (!isFilterActive(filterConfig)) return null;

    const chips: ChipItem[] = [];

    // 1. 未分类
    if (filterConfig.unclassifiedShelf) {
      const isExclude = filterConfig.unclassifiedShelf === "exclude";
      chips.push({
        id: "unclassified",
        label: isExclude
          ? `${t("Exclude")} ${t("Unclassified books")}`
          : t("Unclassified books"),
        isExclude,
        onRemove: this.handleRemoveUnclassified,
      });
    }

    // 2. 书架
    Object.keys(filterConfig.shelves || {}).forEach((shelf) => {
      const state = filterConfig.shelves[shelf];
      if (state) {
        const isExclude = state === "exclude";
        chips.push({
          id: `shelf_${shelf}`,
          label: isExclude
            ? `${t("Exclude")} ${t("Shelf")}: ${shelf}`
            : `${t("Shelf")}: ${shelf}`,
          isExclude,
          onRemove: () => this.handleRemoveShelf(shelf),
        });
      }
    });

    // 3. 阅读状态
    const statusLabelMap: { [key: string]: string } = {
      unread: t("Unread"),
      reading: t("CurrentlyReading"),
      finished: t("Finished"),
    };
    Object.keys(filterConfig.readingStatus || {}).forEach((status) => {
      const state = filterConfig.readingStatus[status];
      if (state) {
        const isExclude = state === "exclude";
        const name = statusLabelMap[status] || status;
        chips.push({
          id: `status_${status}`,
          label: isExclude ? `${t("Exclude")} ${name}` : name,
          isExclude,
          onRemove: () => this.handleRemoveReadingStatus(status),
        });
      }
    });

    // 4. 图书格式（优先智能聚合全部小说/全部漫画）
    const activeFormats = Object.keys(filterConfig.formats || {}).filter(
      (f) => Boolean(filterConfig.formats[f])
    );
    const handledFmts = new Set<string>();

    const checkAllGroup = (groupLabel: string, groupFmts: string[]) => {
      const lowerFmts = groupFmts.map((f) => f.toLowerCase());
      const firstState = filterConfig.formats[lowerFmts[0]];
      if (
        firstState &&
        lowerFmts.every((f) => filterConfig.formats[f] === firstState)
      ) {
        const isExclude = firstState === "exclude";
        chips.push({
          id: `fmt_group_${groupLabel}`,
          label: isExclude
            ? `${t("Exclude")} ${t(groupLabel)}`
            : `${t(groupLabel)}`,
          isExclude,
          onRemove: () => {
            const nextFormats = { ...this.props.filterConfig.formats };
            lowerFmts.forEach((f) => delete nextFormats[f]);
            this.props.handleFilterConfig({
              ...this.props.filterConfig,
              formats: nextFormats,
            });
          },
        });
        lowerFmts.forEach((f) => handledFmts.add(f));
      }
    };

    checkAllGroup("All novels", NOVEL_FORMATS);
    checkAllGroup("All comics", COMIC_FORMATS);

    activeFormats.forEach((fmt) => {
      if (handledFmts.has(fmt.toLowerCase())) return;
      const state = filterConfig.formats[fmt];
      if (state) {
        const isExclude = state === "exclude";
        const fmtUpper = fmt.toUpperCase();
        chips.push({
          id: `fmt_${fmt}`,
          label: isExclude ? `${t("Exclude")} ${fmtUpper}` : fmtUpper,
          isExclude,
          onRemove: () => this.handleRemoveFormat(fmt),
        });
      }
    });

    // 5. 作者
    Object.keys(filterConfig.authors || {}).forEach((author) => {
      const state = filterConfig.authors[author];
      if (state) {
        const isExclude = state === "exclude";
        chips.push({
          id: `author_${author}`,
          label: isExclude ? `${t("Exclude")} ${author}` : `${t("Author")}: ${author}`,
          isExclude,
          onRemove: () => this.handleRemoveAuthor(author),
        });
      }
    });

    // 6. 收藏状态
    if (filterConfig.favorite) {
      const isExclude = filterConfig.favorite === "exclude";
      chips.push({
        id: "fav",
        label: isExclude ? t("Unfavorited only") : t("Favorited only"),
        isExclude,
        onRemove: this.handleRemoveFavorite,
      });
    }

    if (chips.length === 0) return null;

    return (
      <div className="active-filter-bar">
        <div className="active-filter-label">
          <span className="icon-filter" style={{ fontSize: "13px" }}></span>
          <span><Trans>Active filters</Trans>:</span>
        </div>
        <div className="active-filter-chips">
          {chips.map((chip) => (
            <span
              key={chip.id}
              className={`active-filter-chip ${chip.isExclude ? "exclude" : "include"}`}
            >
              <span>{chip.label}</span>
              <span
                className="active-filter-chip-remove"
                onClick={chip.onRemove}
                title={t("Remove condition")}
              >
                ✕
              </span>
            </span>
          ))}
          <span
            className="active-filter-clear-all"
            onClick={() => this.props.handleFilterConfig(createEmptyFilterConfig())}
          >
            <Trans>Clear all</Trans>
          </span>
        </div>
      </div>
    );
  }
}

export default ActiveFilterBar;
