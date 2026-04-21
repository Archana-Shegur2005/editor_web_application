// This file must be imported FIRST in index.js.
// Suppresses the "ResizeObserver loop completed with undelivered notifications"
// error that CRA's dev overlay incorrectly treats as a crash.
// Using capture=true so our handler runs before CRA's overlay listener.
window.addEventListener(
  'error',
  (e) => {
    if (e.message && e.message.includes('ResizeObserver loop')) {
      e.stopImmediatePropagation();
      e.preventDefault();
    }
  },
  true
);

const _origOnError = window.onerror;
window.onerror = function (msg, src, line, col, err) {
  if (typeof msg === 'string' && msg.includes('ResizeObserver loop')) return true;
  return _origOnError ? _origOnError.call(this, msg, src, line, col, err) : false;
};