export interface Feedback {
  kind: 'success' | 'error';
  message: string;
}

export interface FeedbackNoticeState extends Feedback {
  id: string;
}

export interface FeedbackMessages {
  success: string;
  error: string;
}

export const runFeedbackTask = async (
  task: () => void | Promise<void>,
  messages: FeedbackMessages,
  notify: (feedback: Feedback) => void,
): Promise<void> => {
  try {
    await task();
    notify({ kind: 'success', message: messages.success });
  } catch (error) {
    console.error(messages.error, error);
    notify({ kind: 'error', message: messages.error });
  }
};
