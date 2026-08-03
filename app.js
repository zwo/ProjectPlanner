/* ============================================================
   App orchestration
   ============================================================ */
(function () {
  const state = {
    tasks: [],            // [{ id, type, description, startDate, endDate }]
    nextId: 1,
    pastelAssigned: new Set(), // task ids that have been allocated a pastel color
  };

  const els = {
    taskTypeRadios: document.querySelectorAll('input[name="task-type"]'),
    addTaskBtn: document.getElementById('add-task-btn'),
    taskList: document.getElementById('task-list'),
    taskListEmpty: document.getElementById('task-list-empty'),
    generateBtn: document.getElementById('generate-calendar-btn'),
    calendarView: document.getElementById('calendar-view'),
  };

  function getSelectedType() {
    const checked = document.querySelector('input[name="task-type"]:checked');
    return checked ? checked.value : 'task';
  }

  function formatTaskDates(task) {
    const fmt = window.__dpFormatDate;
    if (task.type === 'milestone') {
      return fmt(task.startDate);
    }
    return window.__dpFormatRange(task.startDate, task.endDate);
  }

  /* ---------- Add Task flow ---------- */
  els.addTaskBtn.addEventListener('click', () => {
    const mode = getSelectedType();
    window.openDatePicker({
      mode,
      onConfirm: ({ startDate, endDate }) => {
        const task = {
          id: state.nextId++,
          type: mode,
          description: '',
          startDate,
          endDate: mode === 'milestone' ? startDate : endDate,
        };
        state.tasks.push(task);
        // Touch pastel color so it's assigned in a stable order
        if (task.type === 'task') {
          window.__cal.pastelColor(task.id);
          state.pastelAssigned.add(task.id);
        }
        renderList();
        updateGenerateBtn();
      },
      onCancel: () => { /* nothing */ },
    });
  });

  /* ---------- Task list rendering ---------- */
  function renderList() {
    // Empty state
    if (state.tasks.length === 0) {
      els.taskList.innerHTML = '';
      const empty = document.createElement('div');
      empty.className = 'task-list__empty';
      empty.textContent = 'No tasks yet. Add one to get started.';
      els.taskList.appendChild(empty);
      return;
    }

    els.taskList.innerHTML = '';
    for (const task of state.tasks) {
      els.taskList.appendChild(buildItem(task));
    }
  }

  function buildItem(task) {
    const item = document.createElement('div');
    item.className = 'task-item' + (task.type === 'milestone' ? ' task-item--milestone' : '');
    item.dataset.taskId = task.id;

    // Swatch (color preview for task, star for milestone)
    const swatch = document.createElement('span');
    if (task.type === 'task') {
      swatch.className = 'task-item__swatch';
      swatch.title = 'Click to change color';
      swatch.style.background = window.__cal.getTaskColor(task.id);
      swatch.addEventListener('click', () => {
        openColorPickerForTask(task, swatch);
      });
    } else {
      swatch.className = 'task-item__swatch task-item__swatch--milestone';
      swatch.textContent = '★';
    }
    item.appendChild(swatch);

    // Description input
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'task-item__desc';
    input.placeholder = task.type === 'milestone' ? 'milestone description' : 'task description';
    input.value = task.description || '';
    input.addEventListener('input', () => {
      task.description = input.value;
      // No full re-render to preserve focus
    });
    item.appendChild(input);

    // Dates
    const dates = document.createElement('span');
    dates.className = 'task-item__dates';
    dates.textContent = formatTaskDates(task);
    item.appendChild(dates);

    // Delete
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'btn btn--danger';
    del.textContent = 'Delete';
    del.addEventListener('click', () => {
      const idx = state.tasks.findIndex(t => t.id === task.id);
      if (idx >= 0) state.tasks.splice(idx, 1);
      window.__cal.forgetPastel(task.id);
      window.__cal.clearCustomColor(task.id);
      state.pastelAssigned.delete(task.id);
      renderList();
      updateGenerateBtn();
      // If calendar is already shown, regenerate it
      if (els.calendarView.children.length) {
        generateCalendar();
      }
    });
    item.appendChild(del);

    return item;
  }

  /* ---------- Color picker modal ---------- */
  function openColorPickerForTask(task, swatchEl) {
    const currentColor = window.__cal.getTaskColor(task.id);
    window.openColorPicker({
      currentColor,
      onConfirm: (newColor) => {
        task.customColor = newColor;
        window.__cal.setCustomColor(task.id, newColor);
        swatchEl.style.background = newColor;
        if (els.calendarView.children.length) {
          generateCalendar();
        }
      },
      onCancel: () => { /* nothing to undo — swatch was not mutated */ },
    });
  }

  /* ---------- Generate calendar ---------- */
  function updateGenerateBtn() {
    els.generateBtn.disabled = state.tasks.length === 0;
  }

  function generateCalendar() {
    window.renderCalendar(state.tasks, els.calendarView);
  }

  els.generateBtn.addEventListener('click', () => {
    if (state.tasks.length === 0) return;
    // Clear pastel cache to refresh colors if user deleted tasks (so colors stay distinct)
    // Actually keep cache stable — same task always same color
    generateCalendar();
    // Scroll into view
    els.calendarView.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  /* ---------- Init ---------- */
  renderList();
  updateGenerateBtn();
})();
