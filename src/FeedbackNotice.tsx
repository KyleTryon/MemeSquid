import { CheckCircle2, CircleAlert, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { FeedbackNoticeState } from './feedback';

interface FeedbackNoticeProps {
  notice: FeedbackNoticeState | null;
  onDismiss: (id: string) => void;
}

export const FeedbackNotice = ({ notice, onDismiss }: FeedbackNoticeProps) => {
  const [isHovered, setIsHovered] = useState(false);
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    if (!notice || notice.kind === 'error' || isHovered || isFocused) return;
    const timer = window.setTimeout(() => onDismiss(notice.id), 6000);
    return () => window.clearTimeout(timer);
  }, [notice, onDismiss, isHovered, isFocused]);

  const isError = notice?.kind === 'error';
  const Icon = isError ? CircleAlert : CheckCircle2;

  return (
    <div
      className={
        notice
          ? `pointer-events-auto my-3 flex shrink-0 items-start gap-3 rounded-xl border bg-surface p-3 text-sm text-content-strong ${isError ? 'border-danger/40' : 'border-accent/40'}`
          : 'sr-only'
      }
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onFocus={() => setIsFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setIsFocused(false);
      }}
    >
      {notice && (
        <Icon
          size={20}
          aria-hidden="true"
          className={`mt-3 shrink-0 ${isError ? 'text-danger' : 'text-accent'}`}
        />
      )}
      <div className="min-w-0 flex-1 self-center break-words leading-relaxed">
        <p role="status" aria-atomic="true">
          {notice?.kind === 'success' && <span key={notice.id}>{notice.message}</span>}
        </p>
        <p role="alert" aria-atomic="true">
          {isError && <span key={notice.id}>{notice.message}</span>}
        </p>
      </div>
      {notice && (
        <button
          type="button"
          onClick={() => {
            setIsHovered(false);
            setIsFocused(false);
            onDismiss(notice.id);
          }}
          className="dialog-close-button"
          aria-label="Dismiss notification"
          title="Dismiss notification"
        >
          <X size={18} aria-hidden="true" />
        </button>
      )}
    </div>
  );
};
