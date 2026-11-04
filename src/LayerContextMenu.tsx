import { BringToFront, ChevronDown, ChevronUp, SendToBack } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef } from 'react';
import type { LayerOrderAction } from './layerOrder';

export interface LayerContextMenuState {
  id: string;
  x: number;
  y: number;
}

interface LayerContextMenuProps {
  menu: LayerContextMenuState;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onArrange: (id: string, action: LayerOrderAction) => void;
  onClose: () => void;
}

const isApplePlatform =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent);
const MOD = isApplePlatform ? '⌘' : 'Ctrl+';
const SHIFT = isApplePlatform ? '⇧' : 'Shift+';

const LAYER_MENU_ITEMS: {
  action: LayerOrderAction;
  label: string;
  shortcut: string;
  Icon: LucideIcon;
}[] = [
  { action: 'front', label: 'Bring to front', shortcut: `${MOD}${SHIFT}]`, Icon: BringToFront },
  { action: 'forward', label: 'Bring forward', shortcut: `${MOD}]`, Icon: ChevronUp },
  { action: 'backward', label: 'Send backward', shortcut: `${MOD}[`, Icon: ChevronDown },
  { action: 'back', label: 'Send to back', shortcut: `${MOD}${SHIFT}[`, Icon: SendToBack },
];

const VIEWPORT_MARGIN = 8;

export const LayerContextMenu = ({
  menu,
  canMoveUp,
  canMoveDown,
  onArrange,
  onClose,
}: LayerContextMenuProps) => {
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Keep the menu on screen when opened near the right or bottom edge.
  useLayoutEffect(() => {
    const element = menuRef.current;
    if (!element) return;
    const { width, height } = element.getBoundingClientRect();
    const x = Math.max(
      VIEWPORT_MARGIN,
      Math.min(menu.x, window.innerWidth - width - VIEWPORT_MARGIN),
    );
    const y = Math.max(
      VIEWPORT_MARGIN,
      Math.min(menu.y, window.innerHeight - height - VIEWPORT_MARGIN),
    );
    element.style.transform = `translate(${x}px, ${y}px)`;
    element.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, [menu]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || event.key === 'Tab') {
        event.preventDefault();
        onClose();
        return;
      }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const items = Array.from(
        menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [],
      );
      if (items.length === 0) return;
      const activeIndex = items.findIndex((item) => item === document.activeElement);
      let nextIndex = 0;
      if (event.key === 'End') nextIndex = items.length - 1;
      if (event.key === 'ArrowUp')
        nextIndex = activeIndex <= 0 ? items.length - 1 : activeIndex - 1;
      if (event.key === 'ArrowDown')
        nextIndex = activeIndex >= items.length - 1 ? 0 : activeIndex + 1;
      items[nextIndex].focus();
    };

    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('resize', onClose);
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);

  return (
    <>
      <div
        className="fixed inset-0 z-[105]"
        aria-hidden="true"
        onPointerDown={onClose}
        onContextMenu={(event) => {
          event.preventDefault();
          onClose();
        }}
      />
      <div
        ref={menuRef}
        role="menu"
        aria-label="Arrange layer"
        style={{ transform: `translate(${menu.x}px, ${menu.y}px)` }}
        onContextMenu={(event) => event.preventDefault()}
        className="fixed left-0 top-0 z-[110] w-56 overflow-hidden rounded-lg border border-border bg-surface p-1 shadow-lg"
      >
        {LAYER_MENU_ITEMS.map(({ action, label, shortcut, Icon }) => {
          const isUp = action === 'front' || action === 'forward';
          return (
            <button
              key={action}
              type="button"
              role="menuitem"
              disabled={isUp ? !canMoveUp : !canMoveDown}
              onClick={() => {
                onArrange(menu.id, action);
                onClose();
              }}
              className="flex min-h-11 w-full items-center gap-2 rounded-md px-3 text-left text-sm text-content hover:bg-surface-hover hover:text-content-strong focus-visible:bg-surface-hover focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent pointer-fine:min-h-9"
            >
              <Icon size={14} aria-hidden="true" />
              <span className="flex-1">{label}</span>
              <kbd className="font-sans text-xs text-content-muted">{shortcut}</kbd>
            </button>
          );
        })}
      </div>
    </>
  );
};
