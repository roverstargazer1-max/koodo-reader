const desktopOnlyModes = new Set(["jmcomic"]);
const isDesktopRuntime =
  typeof window !== "undefined" && Boolean(window.electronAPI);

const allSideMenuItems = [
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
    mode: "jmcomic",
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
  (item) => isDesktopRuntime || !desktopOnlyModes.has(item.mode)
);
