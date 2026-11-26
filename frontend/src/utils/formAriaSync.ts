import { useEffect, RefObject } from 'react';

let sharedAnnouncer: HTMLDivElement | null = null;
let announceTimer: ReturnType<typeof setTimeout> | undefined;
let announcedField: Element | null = null;

function getAnnouncer(): HTMLDivElement {
  if (!sharedAnnouncer) {
    sharedAnnouncer = document.createElement('div');
    sharedAnnouncer.setAttribute('aria-live', 'polite');
    sharedAnnouncer.className = 'visually-hidden';
    document.body.append(sharedAnnouncer);
  }
  return sharedAnnouncer;
}

function linkError(el: HTMLElement, shown: boolean) {
  const errorId = el.dataset.error;
  if (!errorId) return;
  const ids = (el.getAttribute('aria-describedby') || '')
    .split(/\s+/)
    .filter((id) => id && id !== errorId);
  if (shown) ids.push(errorId);
  if (ids.length) el.setAttribute('aria-describedby', ids.join(' '));
  else el.removeAttribute('aria-describedby');
}

function announceError(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement) {
  const errorId = el.dataset.error;
  if (!errorId) return;
  const errorEl = document.getElementById(errorId);
  if (!errorEl) return;
  const labelText = el.labels?.[0]?.textContent?.trim() || '';
  const prefix = labelText ? `${labelText}: ` : '';
  const announcer = getAnnouncer();
  clearTimeout(announceTimer);
  announcer.textContent = '';
  announcedField = el;
  announceTimer = setTimeout(() => {
    announcer.textContent = prefix + (errorEl.textContent?.replace(/\s+/g, ' ').trim() || '');
  }, 450);
}

/**
 * Synchronizes native :user-invalid (plus fallback for older engines) with
 * aria-invalid, aria-describedby, and a single polite live region.
 */
export function useAccessibleFormValidation(
  formRef: RefObject<HTMLFormElement | null>,
  deps: unknown[] = [],
) {
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;

    const supportsUserInvalid = CSS.supports('selector(:user-invalid)');
    const dirtyState = new WeakMap<Element, { interacted: boolean; blurred: boolean }>();
    const flagged = new WeakSet<Element>();
    const announced = new WeakSet<Element>();

    const controls = () =>
      Array.from(
        form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
          'input, select, textarea',
        ),
      );

    const syncControl = (
      el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
      announce = false,
    ) => {
      let invalid = false;
      if (supportsUserInvalid) {
        invalid = el.matches(':user-invalid');
      } else {
        const state = dirtyState.get(el);
        invalid = Boolean(state?.interacted && state?.blurred && !el.validity.valid);
        el.classList.toggle('user-invalid-fallback', invalid);
      }

      if (invalid) {
        if (announce && !announced.has(el)) {
          announceError(el);
          announced.add(el);
        }
        el.setAttribute('aria-invalid', 'true');
        linkError(el, true);
        flagged.add(el);
      } else if (flagged.has(el) || el.getAttribute('aria-invalid') !== 'true') {
        el.setAttribute('aria-invalid', 'false');
        linkError(el, false);
        flagged.delete(el);
        announced.delete(el);
        if (announcedField === el) {
          clearTimeout(announceTimer);
          getAnnouncer().textContent = '';
        }
      }
    };

    controls().forEach((el) => {
      if (!el.hasAttribute('aria-invalid')) {
        el.setAttribute('aria-invalid', 'false');
      }
    });

    const onBlur = (e: Event) => {
      const target = e.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
      if (!target?.matches?.('input, select, textarea')) return;
      const st = dirtyState.get(target) || { interacted: false, blurred: false };
      st.blurred = true;
      dirtyState.set(target, st);
      syncControl(target, true);
    };

    const onInput = (e: Event) => {
      const target = e.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
      if (!target?.matches?.('input, select, textarea')) return;
      const st = dirtyState.get(target) || { interacted: false, blurred: false };
      st.interacted = true;
      dirtyState.set(target, st);
      if (target.hasAttribute('aria-invalid')) {
        syncControl(target, false);
      }
    };

    const onChange = (e: Event) => {
      const target = e.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
      if (!target?.matches?.('input, select, textarea')) return;
      const st = dirtyState.get(target) || { interacted: false, blurred: false };
      st.interacted = true;
      dirtyState.set(target, st);
      syncControl(target, true);
    };

    const onInvalid = (e: Event) => {
      const target = e.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
      if (!target?.matches?.('input, select, textarea')) return;
      dirtyState.set(target, { interacted: true, blurred: true });
      announced.add(target);
      syncControl(target, false);
    };

    const onReset = () => {
      setTimeout(() => {
        controls().forEach((el) => {
          dirtyState.delete(el);
          el.classList.remove('user-invalid-fallback');
          syncControl(el, false);
        });
      });
    };

    form.addEventListener('blur', onBlur, true);
    form.addEventListener('input', onInput);
    form.addEventListener('change', onChange, true);
    form.addEventListener('invalid', onInvalid, true);
    form.addEventListener('reset', onReset, true);

    return () => {
      form.removeEventListener('blur', onBlur, true);
      form.removeEventListener('input', onInput);
      form.removeEventListener('change', onChange, true);
      form.removeEventListener('invalid', onInvalid, true);
      form.removeEventListener('reset', onReset, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formRef, ...deps]);
}

export function bindModalLightDismiss(dialog: HTMLDialogElement | null) {
  if (!dialog) return () => {};
  if ('closedBy' in HTMLDialogElement.prototype) {
    dialog.setAttribute('closedby', 'any');
    return () => {};
  }

  let pressedOutside = false;
  const isOutside = (e: PointerEvent) => {
    const r = dialog.getBoundingClientRect();
    return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
  };
  const onDown = (e: PointerEvent) => {
    pressedOutside = isOutside(e);
  };
  const onUp = (e: PointerEvent) => {
    if (pressedOutside && isOutside(e)) dialog.close();
  };
  dialog.addEventListener('pointerdown', onDown);
  dialog.addEventListener('pointerup', onUp);
  return () => {
    dialog.removeEventListener('pointerdown', onDown);
    dialog.removeEventListener('pointerup', onUp);
  };
}
