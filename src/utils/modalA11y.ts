import { useEffect, useRef } from 'react';

/**
 * 弹窗键盘/读屏支持（一次解决四件事，接入方式见文件尾注释）：
 *
 * 1. 焦点进入：打开时把焦点移进弹窗容器（此前焦点留在背景，读屏用户
 *    根本不知道弹窗出现了；Tab 也会在遮住的背景里游走）
 * 2. Escape 关闭：全项目此前 0 处 Escape 支持，键盘用户无法关闭任何弹窗
 * 3. 焦点环路：Tab/Shift+Tab 在弹窗内循环，不会跑到遮罩背后
 * 4. 焦点归还：关闭时把焦点还给打开弹窗前的元素，否则焦点掉到 body，
 *    键盘用户要重新 Tab 一整遍
 */
export function useModalA11y(
  open: boolean,
  onClose: () => void,
  label: string,
  opts?: { closeOnEscape?: boolean },
) {
  const ref = useRef<HTMLDivElement>(null);
  const closeOnEscape = opts?.closeOnEscape !== false;
  // onClose 每次渲染都是新引用；用 ref 转发，避免 effect 因依赖变化反复重跑
  // （重跑会先执行 cleanup 里的 prev?.focus()，把焦点偷还给背景）
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  useEffect(() => {
    if (!open) return;
    const root = ref.current;
    if (!root) return;
    const prev = document.activeElement as HTMLElement | null;
    root.focus({ preventScroll: true });

    const onKey = (e: KeyboardEvent) => {
      if (closeOnEscape && e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const focusables = root.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      prev?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, closeOnEscape]);

  return {
    ref,
    dialogProps: {
      role: 'dialog' as const,
      'aria-modal': true as const,
      'aria-label': label,
      tabIndex: -1 as const,
    },
  };
}

/* 接入方式：
 *   const { ref, dialogProps } = useModalA11y(isOpen, onClose, 'AI 顾问模型设置');
 *   return (
 *     <div ref={ref} {...dialogProps} className="fixed inset-0 ...">
 *       ...
 *     </div>
 *   );
 * 若组件无论开关都常驻渲染，open 传"是否处于打开态"的布尔即可（hook 内部自行守卫）。
 */
