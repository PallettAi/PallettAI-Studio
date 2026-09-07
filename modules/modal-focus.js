'use strict';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function nextFocusIndex(current, length, shift) {
  if (!length) return -1;
  if (shift) return current <= 0 ? length - 1 : current - 1;
  return current >= length - 1 ? 0 : current + 1;
}

function listFocusable(root) {
  if (!root || !root.querySelectorAll) return [];
  return Array.prototype.slice.call(root.querySelectorAll(FOCUSABLE)).filter((el) => {
    if (el.hidden || el.getAttribute('aria-hidden') === 'true') return false;
    if (el.closest('[hidden]')) return false;
    return true;
  });
}

const ModalFocus = { FOCUSABLE, nextFocusIndex, listFocusable };
if (typeof module !== 'undefined' && module.exports) module.exports = ModalFocus;
