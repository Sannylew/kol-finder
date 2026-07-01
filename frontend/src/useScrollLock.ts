import { useEffect } from "react";

// 当 locked 为 true 时锁定页面滚动，关闭时恢复。
// 用引用计数支持多个弹窗/抽屉同时存在的场景。
let lockCount = 0;
let savedOverflow = "";

export function useScrollLock(locked: boolean): void {
  useEffect(() => {
    if (!locked) return;
    if (lockCount === 0) {
      savedOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    lockCount += 1;
    return () => {
      lockCount -= 1;
      if (lockCount === 0) {
        document.body.style.overflow = savedOverflow;
      }
    };
  }, [locked]);
}
