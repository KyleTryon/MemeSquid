import { useEffect, useEffectEvent, useRef } from 'react';

const DIALOG_FOCUSABLE_SELECTOR = [
  'a[href]',
  'summary',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function useDialogFocus<T extends HTMLElement = HTMLDivElement>(
  isOpen: boolean,
  onDismiss: () => void,
  trapFocus: boolean = true,
) {
  const dialogRef = useRef<T | null>(null);
  const dismiss = useEffectEvent(onDismiss);

  useEffect(() => {
    if (!isOpen) return;

    const dialog = dialogRef.current;
    if (!dialog) return;

    const getVisibleControls = () =>
      Array.from(dialog.querySelectorAll<HTMLElement>(DIALOG_FOCUSABLE_SELECTOR)).filter(
        (element) => element.getClientRects().length > 0,
      );

    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusDialog = window.requestAnimationFrame(() => {
      const visibleControls = getVisibleControls();
      const initialFocus =
        visibleControls.find((element) => element.hasAttribute('data-dialog-initial-focus')) ??
        visibleControls[0] ??
        dialog;
      initialFocus.focus();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        dismiss();
        return;
      }

      if (!trapFocus || event.key !== 'Tab') return;

      const focusableElements = getVisibleControls();

      if (focusableElements.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      const focusIsOutsideControls = !focusableElements.some(
        (element) => element === document.activeElement,
      );
      if (event.shiftKey && (document.activeElement === firstElement || focusIsOutsideControls)) {
        event.preventDefault();
        lastElement.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === lastElement || focusIsOutsideControls)
      ) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.cancelAnimationFrame(focusDialog);
      document.removeEventListener('keydown', handleKeyDown, true);
      if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus();
    };
  }, [isOpen, trapFocus]);

  return dialogRef;
}
