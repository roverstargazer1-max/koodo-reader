export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

/**
 * 判断两个矩形是否有重叠（触摸即选）
 */
export const isRectOverlap = (r1: Rect, r2: Rect): boolean => {
  return !(
    r1.right < r2.left ||
    r1.left > r2.right ||
    r1.bottom < r2.top ||
    r1.top > r2.bottom
  );
};
