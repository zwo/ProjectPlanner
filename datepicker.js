/* ============================================================
   Date picker modal — vanilla JS component
   Exposes: window.openDatePicker({ mode, onConfirm, onCancel })

   Implementation notes:
   - Grid is built once per visible month. State changes (start/end/hover)
     only refresh button classes — they never rebuild the grid. This avoids
     losing click events when the mouse is hovering (the previous
     mouseenter-triggered rebuild was eating clicks during PICKING_END).
   - Click + hover handled via event delegation on the grid container.
   ============================================================ */
(function () {
  const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  const STATE = {
    PICKING_START: 'PICKING_START',
    PICKING_END: 'PICKING_END',
    CONFIRMABLE: 'CONFIRMABLE'
  };

  function dayStart(d) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x.getTime();
  }

  function sameDay(a, b) {
    return dayStart(a) === dayStart(b);
  }

  function formatDate(d) {
    return `${MONTH_NAMES[d.getMonth()].slice(0, 3)} ${d.getDate()}, ${d.getFullYear()}`;
  }

  function formatRange(s, e) {
    if (!s || !e) return s ? formatDate(s) : '';
    if (sameDay(s, e)) return formatDate(s);
    return `${formatDate(s)} – ${formatDate(e)}`;
  }

  // Build a 6x7 grid of dates for a given visible month (month index 0-11, year)
  function buildMonthCells(year, month) {
    const firstOfMonth = new Date(year, month, 1);
    const offsetMon = (firstOfMonth.getDay() + 6) % 7; // Mon=0..Sun=6
    const start = new Date(year, month, 1 - offsetMon);
    const cells = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      cells.push(d);
    }
    return cells;
  }

  function openDatePicker({ mode, onConfirm, onCancel }) {
    const root = document.getElementById('modal-root');
    root.innerHTML = '';

    const state = {
      mode: mode === 'milestone' ? 'milestone' : 'task',
      phase: mode === 'milestone' ? STATE.PICKING_END : STATE.PICKING_START,
      start: null,
      end: null,
      hover: null,
      viewYear: new Date().getFullYear(),
      viewMonth: new Date().getMonth()
    };

    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <header class="modal__header">
          <span class="modal__title">${state.mode === 'milestone' ? 'Pick milestone date' : 'Pick task dates'}</span>
          <button class="modal__close" type="button" aria-label="Close">×</button>
        </header>
        <div class="modal__body">
          <div class="modal__nav">
            <button class="modal__prev" type="button" aria-label="Previous month">‹</button>
            <span class="modal__month-label"></span>
            <button class="modal__next" type="button" aria-label="Next month">›</button>
          </div>
          <div class="dp-grid"></div>
        </div>
        <footer class="modal__footer">
          <span class="modal__status"></span>
          <div class="modal__actions">
            <button class="btn btn--ghost modal__cancel" type="button">Cancel</button>
            <button class="btn btn--primary modal__confirm" type="button" disabled>Confirm</button>
          </div>
        </footer>
      </div>
    `;
    root.appendChild(backdrop);

    const $monthLabel = backdrop.querySelector('.modal__month-label');
    const $grid = backdrop.querySelector('.dp-grid');
    const $status = backdrop.querySelector('.modal__status');
    const $confirm = backdrop.querySelector('.modal__confirm');

    /* ---------- Grid build (only when month changes) ---------- */
    function buildGrid() {
      $grid.innerHTML = '';

      WEEKDAY_LABELS.forEach(label => {
        const el = document.createElement('div');
        el.className = 'dp-weekday';
        el.textContent = label;
        $grid.appendChild(el);
      });

      const cells = buildMonthCells(state.viewYear, state.viewMonth);
      cells.forEach(d => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'dp-day';
        btn.textContent = d.getDate();
        // Store day-start timestamp so click/hover handlers can read it
        // without closing over a stale `d` after a re-render.
        btn.dataset.time = String(dayStart(d));
        if (d.getMonth() !== state.viewMonth) btn.classList.add('dp-day--out');
        $grid.appendChild(btn);
      });
    }

    /* ---------- Class refresh (no DOM rebuild) ---------- */
    function refreshClasses() {
      const buttons = $grid.querySelectorAll('.dp-day');
      const sTime = state.start ? dayStart(state.start) : null;
      const eTime = state.end ? dayStart(state.end) : null;
      const hTime = state.hover ? dayStart(state.hover) : null;
      const previewing = state.phase === STATE.PICKING_END && state.start && state.hover;
      const lo = previewing ? Math.min(sTime, hTime) : null;
      const hi = previewing ? Math.max(sTime, hTime) : null;

      buttons.forEach(btn => {
        const t = Number(btn.dataset.time);
        btn.classList.remove('dp-day--range-edge', 'dp-day--in-range');
        if (sTime === null) return;
        if (t === sTime || t === eTime) {
          btn.classList.add('dp-day--range-edge');
        } else if (eTime !== null && t >= sTime && t <= eTime) {
          btn.classList.add('dp-day--in-range');
        } else if (previewing && t >= lo && t <= hi) {
          btn.classList.add('dp-day--in-range');
        }
      });
    }

    function updateStatus() {
      if (state.mode === 'milestone') {
        $status.textContent = state.start ? `Selected: ${formatDate(state.start)}` : 'Select a date';
      } else if (state.phase === STATE.PICKING_START) {
        $status.textContent = 'Select start date';
      } else if (state.phase === STATE.PICKING_END) {
        $status.textContent = state.start
          ? `Start: ${formatDate(state.start)} — select end date`
          : 'Select start date';
      } else {
        $status.textContent = formatRange(state.start, state.end);
      }
      $confirm.disabled = state.phase !== STATE.CONFIRMABLE;
    }

    function updateMonthLabel() {
      $monthLabel.textContent = `${MONTH_NAMES[state.viewMonth]} ${state.viewYear}`;
    }

    function refreshAll() {
      updateMonthLabel();
      refreshClasses();
      updateStatus();
    }

    /* ---------- State transition ---------- */
    function onDayClick(time) {
      const d = new Date(time);
      if (state.mode === 'milestone') {
        state.start = d;
        state.end = new Date(d);
        state.phase = STATE.CONFIRMABLE;
      } else {
        const startMs = state.start ? dayStart(state.start) : null;
        if (state.phase === STATE.PICKING_START ||
           (state.phase === STATE.PICKING_END && state.start && time <= startMs)) {
          state.start = d;
          state.end = null;
          state.phase = STATE.PICKING_END;
        } else if (state.phase === STATE.PICKING_END && time > startMs) {
          state.end = d;
          state.phase = STATE.CONFIRMABLE;
        } else if (state.phase === STATE.CONFIRMABLE) {
          state.start = d;
          state.end = null;
          state.phase = STATE.PICKING_END;
        }
      }
      state.hover = null;
      refreshAll();
    }

    /* ---------- Event delegation ---------- */
    $grid.addEventListener('click', (e) => {
      const btn = e.target.closest('.dp-day');
      if (!btn) return;
      const time = Number(btn.dataset.time);
      const d = new Date(time);
      // Navigate if user clicked an out-of-month day
      if (d.getMonth() !== state.viewMonth) {
        state.viewMonth = d.getMonth();
        state.viewYear = d.getFullYear();
        buildGrid();
        refreshAll();
        // Still apply the click
      }
      onDayClick(time);
    });

    $grid.addEventListener('mouseover', (e) => {
      const btn = e.target.closest('.dp-day');
      if (!btn) return;
      if (state.phase !== STATE.PICKING_END) return;
      const time = Number(btn.dataset.time);
      const newHover = new Date(time);
      if (!state.hover || dayStart(state.hover) !== time) {
        state.hover = newHover;
        refreshClasses();
      }
    });

    /* ---------- Close handlers ---------- */
    function close(result) {
      backdrop.remove();
      document.removeEventListener('keydown', onKey);
      if (result) {
        onConfirm && onConfirm({
          type: state.mode,
          startDate: state.start,
          endDate: state.end
        });
      } else {
        onCancel && onCancel();
      }
    }

    function onKey(e) {
      if (e.key === 'Escape') close(null);
    }

    backdrop.querySelector('.modal__close').addEventListener('click', () => close(null));
    backdrop.querySelector('.modal__cancel').addEventListener('click', () => close(null));
    $confirm.addEventListener('click', () => {
      if (state.phase === STATE.CONFIRMABLE) close(true);
    });
    backdrop.querySelector('.modal__prev').addEventListener('click', () => {
      state.viewMonth--;
      if (state.viewMonth < 0) { state.viewMonth = 11; state.viewYear--; }
      buildGrid();
      refreshAll();
    });
    backdrop.querySelector('.modal__next').addEventListener('click', () => {
      state.viewMonth++;
      if (state.viewMonth > 11) { state.viewMonth = 0; state.viewYear++; }
      buildGrid();
      refreshAll();
    });
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) close(null);
    });
    document.addEventListener('keydown', onKey);

    /* ---------- Initial render ---------- */
    buildGrid();
    refreshAll();

    // Focus the close button for accessibility
    setTimeout(() => backdrop.querySelector('.modal__close').focus(), 0);
  }

  window.openDatePicker = openDatePicker;
  window.__dpFormatDate = formatDate;
  window.__dpFormatRange = formatRange;
})();
