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
    cellW: 140, // legacy reference; actual width now driven by 1fr grid columns
    laneH: 28,
    laneGap: 4,
    weekdayRowH: 32,
    dayNumberH: 24,
    cellPadTop: 4,
    cellPadBottom: 4,
    reservedBottom: 40,
    milestoneH: 18,
    milestoneGap: 2,
    minRowH: 64,
  };
  const LANE_UNIT = METRICS.laneH + METRICS.laneGap;       // 32
  const LANES_OFFSET = METRICS.cellPadTop + METRICS.dayNumberH; // 28
  // rowH preserves the original baseline (64 + lanes*32, which already
  // reserves 32px for one milestone) and adds extra only when a row has
  // more milestones than that reserve can fit.
  const BASELINE_MS_RESERVE = 32;
  function milestonesHeight(count) {
    if (count <= 0) return 0;
    return count * METRICS.milestoneH + (count - 1) * METRICS.milestoneGap;
  }
  function rowH(lanes, milestones = 0) {
    const base = METRICS.minRowH + lanes * LANE_UNIT;
    const extra = Math.max(0, milestonesHeight(milestones) - BASELINE_MS_RESERVE);
    return base + extra;
  }

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
    const laneUseByRow = new Map(); // rowIndex -> Set of lanes used
    const daysWithTasks = new Set(); // day-of-month numbers that have at least one task block
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
        // Track which days have tasks (for per-cell layout decisions)
        const segStartDay = Math.round((s.segStart - monthStart) / DAY_MS) + 1;
        const segEndDay = Math.round((s.segEnd - monthStart) / DAY_MS) + 1;
        for (let dn = segStartDay; dn <= segEndDay; dn++) daysWithTasks.add(dn);
        const rowSet = laneUseByRow.get(Math.floor(startOffset / 7)) || new Set();
        rowSet.add(lane);
        laneUseByRow.set(Math.floor(startOffset / 7), rowSet);
      }
      if (segs.length) tasksInMonth.push({ task: t, segs });
    }
    // Milestones within this month (computed early so per-row heights can account for them)
    const milestonesByDay = new Map(); // day-of-month -> [milestone]
    for (const m of milestones) {
      const mDate = new Date(m.startDate);
      if (mDate.getFullYear() === year && mDate.getMonth() === month) {
        const d = mDate.getDate();
        if (!milestonesByDay.has(d)) milestonesByDay.set(d, []);
        milestonesByDay.get(d).push(m);
      }
    }

    // Compute per-row maxLanes and max milestone count — weeks with no tasks
    // stay at default height, weeks with tasks expand based on lane count,
    // and weeks with many milestones on a single day expand further.
    const numRows = totalCells / 7;
    const maxLanesByRow = new Array(numRows).fill(0);
    const maxMilestonesByRow = new Array(numRows).fill(0);
    for (const [rowIdx, laneSet] of laneUseByRow.entries()) {
      let maxLaneIdx = -1;
      for (const l of laneSet) if (l > maxLaneIdx) maxLaneIdx = l;
      maxLanesByRow[rowIdx] = maxLaneIdx + 1;
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const rowIdx = Math.floor((offsetMon + d - 1) / 7);
      const count = milestonesByDay.get(d)?.length || 0;
      if (count > maxMilestonesByRow[rowIdx]) maxMilestonesByRow[rowIdx] = count;
    }
    const rowHByRow = maxLanesByRow.map((lanes, i) => rowH(lanes, maxMilestonesByRow[i]));
    // Cumulative top offset for each week row (where the row starts, just past weekday header)
    const rowTopOffsets = [METRICS.weekdayRowH];
    for (let i = 0; i < numRows; i++) {
      rowTopOffsets.push(rowTopOffsets[i] + rowHByRow[i]);
    }

    // Build the card
    const card = document.createElement('section');
    card.className = 'month-card';

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
    // Set per-row heights so weeks without tasks stay at default height
    // and weeks with tasks expand based on their lane count.
    grid.style.gridTemplateRows = [
      `${METRICS.weekdayRowH}px`,
      ...rowHByRow.map(h => `${h}px`),
    ].join(' ');
    container.appendChild(grid);

    const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    weekdays.forEach(w => {
      const el = document.createElement('div');
      el.className = 'weekday';
      el.textContent = w;
      grid.appendChild(el);
    });

    // Leading empty cells (always in row 0 / first week)
    for (let i = 0; i < offsetMon; i++) {
      const el = document.createElement('div');
      el.className = 'cell cell--empty';
      el.style.setProperty('--max-lanes', maxLanesByRow[0] || 0);
      grid.appendChild(el);
    }
    // Day cells
    for (let d = 1; d <= daysInMonth; d++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      const rowIdx = Math.floor((offsetMon + d - 1) / 7);
      cell.style.setProperty('--max-lanes', maxLanesByRow[rowIdx] || 0);
      if (daysWithTasks.has(d)) cell.classList.add('cell--has-tasks');

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
    const lastRowIdx = numRows - 1;
    for (let i = 0; i < trailing; i++) {
      const el = document.createElement('div');
      el.className = 'cell cell--empty';
      el.style.setProperty('--max-lanes', maxLanesByRow[lastRowIdx] || 0);
      grid.appendChild(el);
    }

    // ---- Overlay layer (task blocks) ----
    const overlay = document.createElement('div');
    overlay.className = 'month-overlay';
    container.appendChild(overlay);

    for (const { task, segs } of tasksInMonth) {
      const color = pastelColor(task.id);
      const label = task.description || 'task';
      for (const seg of segs) {
        const block = document.createElement('div');
        block.className = 'task-block';
        block.style.background = color;
        // Use percentages so blocks stretch with the fluid 1fr grid columns
        block.style.left = `${(seg.colIndex / 7) * 100}%`;
        block.style.width = `${(seg.span / 7) * 100}%`;
        // Use cumulative row offset so each week's height is independent
        block.style.top = `${rowTopOffsets[seg.rowIndex] + LANES_OFFSET + seg.lane * LANE_UNIT}px`;
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
