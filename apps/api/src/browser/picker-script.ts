// Injected into the live browser's page in pick mode. Highlights the element under the pointer, swallows
// clicks (so links and buttons don't fire), and reports the clicked element's text and a CSS selector
// through the __ptPicked binding.
//
// The selector should find the same element in the page's HTML as served (checks read that with
// cheerio): stable IDs and attributes first, class names that don't look generated, positions last.
//
// Kept as a plain string: functions transpiled by tsx/esbuild can reference helpers (__name) that don't
// exist inside the page.
export const PICKER_SCRIPT = String.raw`(() => {
  if (window.__ptPicker) return;
  const Z = 2147483647;
  const box = document.createElement('div');
  box.setAttribute('data-pt-picker', '');
  box.style.cssText = 'position:fixed;pointer-events:none;z-index:' + Z + ';border:2px solid #ea580c;background:rgba(234,88,12,.15);border-radius:3px;display:none;box-sizing:border-box';
  const tip = document.createElement('div');
  tip.setAttribute('data-pt-picker', '');
  tip.style.cssText = 'position:fixed;pointer-events:none;z-index:' + Z + ';background:#111827;color:#fff;font:12px/1.5 system-ui,sans-serif;padding:2px 6px;border-radius:4px;display:none;max-width:60vw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';

  let on = false;
  let hovered = null;
  let picked = null;

  const textOf = (el) => ((el.getAttribute && el.getAttribute('content')) || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  const generated = (c) =>
    /\d{3,}/.test(c) || /^(css|sc|jsx|emotion|svelte|astro|tw|ng)-/.test(c) || /__[A-Za-z0-9_-]{5,}$/.test(c) || /^_[A-Za-z0-9]{5,}$/.test(c) ||
    /^(is|has)-(hover|active|focus|selected|open|visible|loaded)/.test(c) || c.length > 40;
  const count = (sel) => {
    try {
      return document.querySelectorAll(sel).length;
    } catch (e) {
      return 0;
    }
  };
  const stableId = (el) => !!el.id && /^[A-Za-z][\w-]*$/.test(el.id) && !/\d{3,}/.test(el.id) && count('#' + CSS.escape(el.id)) === 1;
  const ATTRS = ['itemprop', 'data-testid', 'data-test', 'data-qa', 'data-cy', 'data-role'];

  function part(el, withPosition) {
    let s = el.tagName.toLowerCase();
    for (const a of ATTRS) {
      const v = el.getAttribute(a);
      if (v && v.length < 60 && !/\d{4,}/.test(v)) {
        s += '[' + a + '="' + v.replace(/["\\]/g, '\\$&') + '"]';
        break;
      }
    }
    s += Array.from(el.classList).filter((c) => !generated(c)).slice(0, 3).map((c) => '.' + CSS.escape(c)).join('');
    if (withPosition && el.parentElement) {
      const same = Array.from(el.parentElement.children).filter((c) => c.tagName === el.tagName);
      if (same.length > 1) s += ':nth-of-type(' + (same.indexOf(el) + 1) + ')';
    }
    return s;
  }

  function selectorFor(el) {
    if (stableId(el)) return '#' + CSS.escape(el.id);
    // The shortest unique chain of ancestors: first without positions, then with them
    for (const withPosition of [false, true]) {
      const parts = [];
      for (let node = el; node && node.nodeType === 1 && node !== document.documentElement; node = node.parentElement) {
        const anchored = node !== el && stableId(node);
        parts.unshift(anchored ? '#' + CSS.escape(node.id) : part(node, withPosition));
        const sel = parts.join(' > ');
        if (count(sel) === 1) return sel;
        if (anchored) break;
      }
    }
    const parts = [];
    for (let node = el; node && node.nodeType === 1 && node !== document.documentElement; node = node.parentElement) parts.unshift(part(node, true));
    return parts.join(' > ');
  }

  function show(el) {
    const r = el.getBoundingClientRect();
    Object.assign(box.style, { display: 'block', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
    tip.textContent = textOf(el) || el.tagName.toLowerCase();
    Object.assign(tip.style, { display: 'block', left: Math.max(0, r.left) + 'px', top: (r.top > 24 ? r.top - 24 : r.bottom + 4) + 'px' });
  }

  function report(el) {
    picked = el;
    show(el);
    window.__ptPicked({ selector: selectorFor(el), text: textOf(el) });
  }

  const swallow = (e) => {
    if (!on) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  };
  const target = (e) => {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    return el && !el.hasAttribute('data-pt-picker') ? el : null;
  };
  document.addEventListener('mousemove', (e) => {
    if (!on) return;
    const el = target(e);
    if (el && el !== hovered) {
      hovered = el;
      show(el);
    }
  }, true);
  for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'dblclick', 'contextmenu', 'auxclick']) document.addEventListener(type, swallow, true);
  document.addEventListener('click', (e) => {
    if (!on) return;
    swallow(e);
    const el = target(e);
    if (el) report(el);
  }, true);

  window.__ptPicker = {
    enable() {
      on = true;
      document.documentElement.append(box, tip);
    },
    disable() {
      on = false;
      box.style.display = 'none';
      tip.style.display = 'none';
    },
    parent() {
      if (picked && picked.parentElement && picked.parentElement !== document.body) report(picked.parentElement);
    },
  };
})();`;
