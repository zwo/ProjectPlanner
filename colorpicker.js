/* ============================================================
   Color picker modal — vanilla JS component
   Exposes: window.openColorPicker({ currentColor, onConfirm, onCancel })

   Implementation notes:
   - Wraps the OS-native <input type="color"> in a confirm/cancel modal so
     the user can experiment with colors and either commit or revert.
   - The native picker is triggered from a button click inside the modal
     (still within user activation), and the choice feeds the live preview.
   - Also exposes a preset palette and a hex input.
   ============================================================ */
(function () {
  // A small curated palette: 8 pastels + 8 saturated colors.
  const PRESETS = [
    '#ffadad', '#ffd6a5', '#fdffb6', '#caffbf',
    '#9bf6ff', '#a0c4ff', '#bdb2ff', '#ffc6ff',
    '#f87171', '#fb923c', '#facc15', '#4ade80',
    '#22d3ee', '#60a5fa', '#a78bfa', '#f472b6',
  ];

  function normalizeHex(value) {
    if (!value) return null;
    const trimmed = value.trim().toLowerCase();
    if (/^#[0-9a-f]{6}$/.test(trimmed)) return trimmed;
    if (/^[0-9a-f]{6}$/.test(trimmed)) return '#' + trimmed;
    if (/^#[0-9a-f]{3}$/.test(trimmed)) {
      return '#' + trimmed.slice(1).split('').map(c => c + c).join('');
    }
    if (/^[0-9a-f]{3}$/.test(trimmed)) {
      return '#' + trimmed.split('').map(c => c + c).join('');
    }
    return null;
  }

  function anyColorToHex(color) {
    if (!color) return '#ffffff';
    const direct = normalizeHex(color);
    if (direct) return direct;
    // Fallback: ask the browser to compute rgb()
    const probe = document.createElement('div');
    probe.style.color = color;
    probe.style.display = 'none';
    document.body.appendChild(probe);
    const computed = getComputedStyle(probe).color;
    document.body.removeChild(probe);
    const m = computed.match(/\d+(?:\.\d+)?/g);
    if (!m || m.length < 3) return '#ffffff';
    return '#' + m.slice(0, 3).map(n => Math.round(Number(n)).toString(16).padStart(2, '0')).join('');
  }

  function openColorPicker({ currentColor, onConfirm, onCancel }) {
    const root = document.getElementById('modal-root');
    root.innerHTML = '';

    const originalColor = anyColorToHex(currentColor);
    let pendingColor = originalColor;

    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal color-modal" role="dialog" aria-modal="true">
        <header class="modal__header">
          <span class="modal__title">Pick task color</span>
          <button class="modal__close" type="button" aria-label="Close">×</button>
        </header>
        <div class="modal__body">
          <div class="color-preview"></div>
          <div class="color-hex-row">
            <span class="color-hex-label">Hex</span>
            <input type="text" class="color-hex-input" maxlength="7" spellcheck="false" />
          </div>
          <div class="color-palette"></div>
          <button class="btn btn--ghost color-native-btn" type="button">Choose custom color…</button>
        </div>
        <footer class="modal__footer">
          <span class="modal__status"></span>
          <div class="modal__actions">
            <button class="btn btn--ghost modal__cancel" type="button">Cancel</button>
            <button class="btn btn--primary modal__confirm" type="button">OK</button>
          </div>
        </footer>
      </div>
    `;
    root.appendChild(backdrop);

    const $preview = backdrop.querySelector('.color-preview');
    const $hex = backdrop.querySelector('.color-hex-input');
    const $palette = backdrop.querySelector('.color-palette');
    const $nativeBtn = backdrop.querySelector('.color-native-btn');
    const $status = backdrop.querySelector('.modal__status');
    const $confirm = backdrop.querySelector('.modal__confirm');

    // Build palette
    PRESETS.forEach(color => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'color-palette__swatch';
      btn.style.background = color;
      btn.setAttribute('aria-label', color);
      btn.dataset.color = color;
      btn.addEventListener('click', () => setPending(color));
      $palette.appendChild(btn);
    });

    function render() {
      $preview.style.background = pendingColor;
      $hex.value = pendingColor;
      $status.textContent = pendingColor;
      // Highlight preset if it matches
      $palette.querySelectorAll('.color-palette__swatch').forEach(btn => {
        btn.classList.toggle('is-active', btn.dataset.color.toLowerCase() === pendingColor.toLowerCase());
      });
    }

    function setPending(color) {
      pendingColor = anyColorToHex(color);
      render();
    }

    function close(commit) {
      backdrop.remove();
      document.removeEventListener('keydown', onKey);
      if (commit) onConfirm && onConfirm(pendingColor);
      else onCancel && onCancel();
    }

    function onKey(e) {
      if (e.key === 'Escape') close(false);
      else if (e.key === 'Enter' && e.target !== $hex) close(true);
    }

    // Wire events
    backdrop.querySelector('.modal__close').addEventListener('click', () => close(false));
    backdrop.querySelector('.modal__cancel').addEventListener('click', () => close(false));
    $confirm.addEventListener('click', () => close(true));

    $hex.addEventListener('input', () => {
      const normalized = normalizeHex($hex.value);
      if (normalized) setPending(normalized);
    });
    $hex.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const normalized = normalizeHex($hex.value);
        if (normalized) setPending(normalized);
      }
    });

    $nativeBtn.addEventListener('click', () => {
      openNativePicker(pendingColor, (newColor) => setPending(newColor));
    });

    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) close(false);
    });
    document.addEventListener('keydown', onKey);

    render();
    setTimeout(() => $confirm.focus(), 0);
  }

  /* Opens the OS-native color picker. Must be called synchronously inside
     a user gesture so the browser accepts the synthetic .click(). */
  function openNativePicker(currentColor, onChange) {
    const existing = document.getElementById('__color-picker-input');
    if (existing) existing.remove();

    const input = document.createElement('input');
    input.type = 'color';
    input.id = '__color-picker-input';
    input.value = anyColorToHex(currentColor);
    input.setAttribute('aria-label', 'Pick custom color');
    Object.assign(input.style, {
      position: 'fixed',
      top: '-1000px',
      left: '-1000px',
      width: '1px',
      height: '1px',
      border: 'none',
      padding: '0',
      background: 'transparent',
    });
    document.body.appendChild(input);

    input.addEventListener('input', () => onChange(input.value));
    input.addEventListener('change', () => {
      onChange(input.value);
      input.remove();
    });

    input.click(); // synchronous within user gesture
  }

  window.openColorPicker = openColorPicker;
  window.__cpAnyColorToHex = anyColorToHex;
})();
