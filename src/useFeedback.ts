import { useCallback, useState } from 'react';
import { runFeedbackTask } from './feedback';
import type { Feedback, FeedbackMessages, FeedbackNoticeState } from './feedback';

export const useFeedback = () => {
  const [notice, setNotice] = useState<FeedbackNoticeState | null>(null);
  const notify = useCallback((feedback: Feedback) => {
    setNotice({ ...feedback, id: crypto.randomUUID() });
  }, []);
  const dismissNotice = useCallback((id: string) => {
    setNotice((current) => (current?.id === id ? null : current));
  }, []);
  const runWithFeedback = useCallback(
    (task: () => void | Promise<void>, messages: FeedbackMessages) =>
      runFeedbackTask(task, messages, notify),
    [notify],
  );

  return { notice, notify, dismissNotice, runWithFeedback };
};
