import assert from 'node:assert/strict';
import test from 'node:test';
import { runFeedbackTask, type Feedback } from './feedback';

const messages = { success: 'Image added.', error: 'The image could not be loaded. Try again.' };

void test('success feedback waits for the complete asynchronous operation', async () => {
  const feedback: Feedback[] = [];
  let complete = () => {};
  const operation = new Promise<void>((resolve) => {
    complete = resolve;
  });
  const result = runFeedbackTask(
    () => operation,
    messages,
    (notice) => feedback.push(notice),
  );
  assert.deepEqual(feedback, []);
  complete();
  await result;
  assert.deepEqual(feedback, [{ kind: 'success', message: messages.success }]);
});

void test('synchronous export failures produce one error notice and no success', async (context) => {
  const log = context.mock.method(console, 'error', () => {});
  const feedback: Feedback[] = [];
  const failure = new Error('Canvas is tainted');
  await runFeedbackTask(
    () => {
      throw failure;
    },
    messages,
    (notice) => feedback.push(notice),
  );
  assert.deepEqual(feedback, [{ kind: 'error', message: messages.error }]);
  assert.deepEqual(log.mock.calls[0].arguments, [messages.error, failure]);
});

void test('rejected clipboard operations report a recovery message without leaking platform errors', async (context) => {
  context.mock.method(console, 'error', () => {});
  const feedback: Feedback[] = [];
  const clipboardMessages = {
    success: 'Meme copied.',
    error: 'Copy failed. Download as PNG instead.',
  };
  await runFeedbackTask(
    () =>
      Promise.reject(new DOMException('Platform-specific permission details', 'NotAllowedError')),
    clipboardMessages,
    (notice) => feedback.push(notice),
  );
  assert.deepEqual(feedback, [{ kind: 'error', message: clipboardMessages.error }]);
});

void test('a failed operation can be retried successfully using the same feedback path', async (context) => {
  context.mock.method(console, 'error', () => {});
  const feedback: Feedback[] = [];
  const notify = (notice: Feedback) => {
    feedback.push(notice);
  };
  await runFeedbackTask(() => Promise.reject(new Error('File read failed')), messages, notify);
  await runFeedbackTask(() => {}, messages, notify);
  assert.deepEqual(
    feedback.map((notice) => notice.kind),
    ['error', 'success'],
  );
});
