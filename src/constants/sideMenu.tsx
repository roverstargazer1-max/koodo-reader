const desktopOnlyModes = new Set(["jmcomic", "onlineComics", "picacomic"]);
const isDesktopRuntime =
  typeof window !== "undefined" && Boolean(window.electronAPI);

export interface SideSubMenuItem {
  name: string;
  icon?: string;
  mode: string;
}

export interface SideMenuItem {
  name: string;
  icon: string;
  mode: string;
  isExpandable?: boolean;
  subItems?: SideSubMenuItem[];
}

const allSideMenuItems: SideMenuItem[] = [
  {
    name: "Books",
    icon: "home-line",
    mode: "home",
  },
  {
    name: "Favorites",
    icon: "heart",
    mode: "favorite",
  },
  {
    name: "Online Comics",
    icon: "image",
    mode: "onlineComics",
    isExpandable: true,
    subItems: [
      {
        name: "JMComic",
        mode: "jmcomic",
      },
      {
        name: "PicaComic",
        mode: "picacomic",
      },
    ],
  },
  {
    name: "Notes",
    icon: "idea-line",
    mode: "note",
  },
  {
    name: "Highlights",
    icon: "highlight-line",
    mode: "highlight",
  },
  {
    name: "Deleted Books",
    icon: "trash-line",
    mode: "trash",
  },
];

export const sideMenu = allSideMenuItems.filter(
  (item) =>
    isDesktopRuntime ||
    process.env.NODE_ENV === "development" ||
    !desktopOnlyModes.has(item.mode)
);
