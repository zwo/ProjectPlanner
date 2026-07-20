/* ============================================================
   Calendar rendering core
   Exposes: window.renderCalendar(tasks, container)
   ============================================================ */
(function () {
  const DAY_MS = 86400000;
  const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  // Metrics — must stay in sync with CSS variables in styles.css
  const METRICS = {
    cellW: 140,
    laneH: 28,
    laneGap: 4,
    weekdayRowH: 32,
    dayNumberH: 24,
    cellPadTop: 4,
    reservedBottom: 40,
  };
  const LANE_UNIT = METRICS.laneH + METRICS.laneGap;       // 32
  const LANES_OFFSET = METRICS.cellPadTop + METRICS.dayNumberH; // 28
  // rowH matches .cell min-height: 24 + maxLanes*32 + 40 = 64 + maxLanes*32
  const rowH = (maxLanes) => 64 + maxLanes * LANE_UNIT;

  /* ---------- Pastel color (golden-angle HSL) ----------
     Uses task.id as the index so deletions don't cause color collisions
     among remaining tasks (cache is just a string memoization). */
  const PASTEL_CACHE = new Map();
  function pastelColor(taskId) {
    if (PASTEL_CACHE.has(taskId)) return PASTEL_CACHE.get(taskId);
    const n = taskId;
    const hue = (n * 137.508) % 360;
    const sat = 60 + ((n * 7) % 15);   // 60-74
    const lig = 80 + ((n * 3) % 6);    // 80-85
    const css = `hsl(${hue.toFixed(1)}, ${sat}%, ${lig}%)`;
    PASTEL_CACHE.set(taskId, css);
    return css;
  }

  function clearPastelCache() { PASTEL_CACHE.clear(); }
  function forgetPastel(taskId) { PASTEL_CACHE.delete(taskId); }

  /* ---------- Date helpers ---------- */
  function dayStart(d) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x.getTime();
  }
  function isSameDay(a, b) { return dayStart(a) === dayStart(b); }

  /* ---------- Lane allocation (greedy first-fit interval partition) ---------- */
  function allocateLanes(tasks) {
    const expanded = tasks
      .filter(t => t.type === 'task')
      .map(t => ({ id: t.id, start: dayStart(t.startDate), end: dayStart(t.endDate) }));
    expanded.sort((a, b) => a.start - b.start || a.end - b.end);

    const lanes = [];           // lanes[i] = end timestamp of last task placed
    const assignment = new Map();
    for (const t of expanded) {
      let placed = -1;
      for (let i = 0; i < lanes.length; i++) {
        if (lanes[i] < t.start) { placed = i; break; } // strict <, leaves 1-day gap
      }
      if (placed === -1) { placed = lanes.length; lanes.push(t.end); }
      else lanes[placed] = t.end;
      assignment.set(t.id, placed);
    }
    return assignment;
  }

  /* ---------- Segment a task within a month range, split at Mondays ---------- */
  function* segmentsInRange(taskStart, taskEnd, rangeStart, rangeEnd) {
    let cursor = Math.max(taskStart, rangeStart);
    const finalEnd = Math.min(taskEnd, rangeEnd);
    if (cursor > finalEnd) return;
    while (cursor <= finalEnd) {
      let segEnd = cursor;
      let probe = cursor + DAY_MS;
      while (probe <= finalEnd) {
        const dow = new Date(probe).getDay(); // 0=Sun..6=Sat
        if (dow === 1) break; // Monday: start new segment
        segEnd = probe;
        probe += DAY_MS;
      }
      yield { segStart: cursor, segEnd };
      cursor = segEnd + DAY_MS;
    }
  }

  /* ---------- Per-month rendering ---------- */
  function buildMonthDays(year, month) {
    const first = new Date(year, month, 1);
    const offsetMon = (first.getDay() + 6) % 7; // 0 for Monday
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const totalRaw = offsetMon + daysInMonth;
    const totalCells = Math.ceil(totalRaw / 7) * 7;
    const trailingEmpty = totalCells - totalRaw;
    return { offsetMon, daysInMonth, totalCells, trailingEmpty };
  }

  function renderMonthCard({ year, month, tasks, milestones, laneAssignment }) {
    const { offsetMon, daysInMonth, totalCells } = buildMonthDays(year, month);
    const monthStart = dayStart(new Date(year, month, 1));
    const monthEnd = dayStart(new Date(year, month, daysInMonth));

    // Determine tasks touching this month + count lanes used here
    const tasksInMonth = [];
    let maxLanes = 0;
    const laneUseByRow = new Map(); // rowIndex -> Set of lanes used
    for (const t of tasks) {
      const tStart = dayStart(t.startDate);
      const tEnd = dayStart(t.endDate);
      if (tEnd < monthStart || tStart > monthEnd) continue;
      const lane = laneAssignment.get(t.id) ?? 0;
      // Collect segments within this month
      const segs = [];
      for (const s of segmentsInRange(tStart, tEnd, monthStart, monthEnd)) {
        const startOffset = offsetMon + Math.round((s.segStart - monthStart) / DAY_MS);
        const endOffset = offsetMon + Math.round((s.segEnd - monthStart) / DAY_MS);
        segs.push({
          colIndex: startOffset % 7,
          rowIndex: Math.floor(startOffset / 7),
          span: endOffset - startOffset + 1,
          lane,
        });
        const rowSet = laneUseByRow.get(Math.floor(startOffset / 7)) || new Set();
        rowSet.add(lane);
        laneUseByRow.set(Math.floor(startOffset / 7), rowSet);
      }
      if (segs.length) tasksInMonth.push({ task: t, segs });
    }
    // maxLanes across all weeks in month (use global max for simplicity, but local is enough)
    for (const rowSet of laneUseByRow.values()) {
      if (rowSet.size > maxLanes) maxLanes = rowSet.size;
    }
    // Better: maxLanes should be max lane index + 1 across all rows
    let maxLaneIndex = -1;
    for (const rowSet of laneUseByRow.values()) {
      for (const l of rowSet) if (l > maxLaneIndex) maxLaneIndex = l;
    }
    maxLanes = Math.max(maxLaneIndex + 1, 0);

    // Milestones within this month
    const milestonesByDay = new Map(); // day-of-month -> [milestone]
    for (const m of milestones) {
      const mDate = new Date(m.startDate);
      if (mDate.getFullYear() === year && mDate.getMonth() === month) {
        const d = mDate.getDate();
        if (!milestonesByDay.has(d)) milestonesByDay.set(d, []);
        milestonesByDay.get(d).push(m);
      }
    }

    // Build the card
    const card = document.createElement('section');
    card.className = 'month-card';
    card.style.setProperty('--max-lanes', maxLanes);
    card.style.setProperty('--row-h', `${rowH(maxLanes)}px`);

    const title = document.createElement('h2');
    title.className = 'month-card__title';
    title.textContent = `${MONTH_NAMES[month]} ${year}`;
    card.appendChild(title);

    const container = document.createElement('div');
    container.className = 'month-container';
    card.appendChild(container);

    // ---- Grid layer ----
    const grid = document.createElement('div');
    grid.className = 'month-grid';
    container.appendChild(grid);

    const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    weekdays.forEach(w => {
      const el = document.createElement('div');
      el.className = 'weekday';
      el.textContent = w;
      grid.appendChild(el);
    });

    // Leading empty cells
    for (let i = 0; i < offsetMon; i++) {
      const el = document.createElement('div');
      el.className = 'cell cell--empty';
      grid.appendChild(el);
    }
    // Day cells
    for (let d = 1; d <= daysInMonth; d++) {
      const cell = document.createElement('div');
      cell.className = 'cell';

      const dayNum = document.createElement('div');
      dayNum.className = 'cell__day-number';
      dayNum.textContent = d;
      cell.appendChild(dayNum);

      const lanes = document.createElement('div');
      lanes.className = 'cell__lanes';
      cell.appendChild(lanes);

      const ms = milestonesByDay.get(d);
      if (ms && ms.length) {
        const mWrap = document.createElement('div');
        mWrap.className = 'cell__milestones';
        ms.forEach(m => {
          const el = document.createElement('div');
          el.className = 'milestone';
          const star = document.createElement('span');
          star.className = 'milestone__star';
          star.textContent = '★';
          const label = document.createElement('span');
          label.textContent = m.description || 'milestone';
          el.appendChild(star);
          el.appendChild(label);
          mWrap.appendChild(el);
        });
        cell.appendChild(mWrap);
      }
      grid.appendChild(cell);
    }
    // Trailing empty cells to fill the last week
    const trailing = totalCells - offsetMon - daysInMonth;
    for (let i = 0; i < trailing; i++) {
      const el = document.createElement('div');
      el.className = 'cell cell--empty';
      grid.appendChild(el);
    }

    // ---- Overlay layer (task blocks) ----
    const overlay = document.createElement('div');
    overlay.className = 'month-overlay';
    container.appendChild(overlay);

    const rH = rowH(maxLanes);
    for (const { task, segs } of tasksInMonth) {
      const color = pastelColor(task.id);
      const label = task.description || 'task';
      for (const seg of segs) {
        const block = document.createElement('div');
        block.className = 'task-block';
        block.style.background = color;
        block.style.left = `${seg.colIndex * METRICS.cellW}px`;
        block.style.width = `${seg.span * METRICS.cellW}px`;
        block.style.top = `${METRICS.weekdayRowH + seg.rowIndex * rH + LANES_OFFSET + seg.lane * LANE_UNIT}px`;
        block.textContent = label;
        overlay.appendChild(block);
      }
    }

    return card;
  }

  /* ---------- Public: render full calendar ---------- */
  function renderCalendar(tasks, container) {
    container.innerHTML = '';
    if (!tasks || !tasks.length) return;

    const taskItems = tasks.filter(t => t.type === 'task');
    const milestoneItems = tasks.filter(t => t.type === 'milestone');

    const laneAssignment = allocateLanes(taskItems);

    // Determine month range
    let minTime = Infinity, maxTime = -Infinity;
    for (const t of tasks) {
      const s = dayStart(t.startDate);
      const e = dayStart(t.type === 'milestone' ? t.startDate : t.endDate);
      if (s < minTime) minTime = s;
      if (e > maxTime) maxTime = e;
    }
    const start = new Date(minTime);
    const end = new Date(maxTime);

    const frag = document.createDocumentFragment();
    let y = start.getFullYear();
    let m = start.getMonth();
    while (y < end.getFullYear() || (y === end.getFullYear() && m <= end.getMonth())) {
      const card = renderMonthCard({
        year: y, month: m,
        tasks: taskItems,
        milestones: milestoneItems,
        laneAssignment,
      });
      frag.appendChild(card);
      m++;
      if (m > 11) { m = 0; y++; }
    }
    container.appendChild(frag);
  }

  window.renderCalendar = renderCalendar;
  window.__cal = {
    pastelColor,
    clearPastelCache,
    forgetPastel,
  };
})();
