// ─────────────────────────────────────────────────────────────────────────────
// Admiral Insights — Frontend SPA
// ─────────────────────────────────────────────────────────────────────────────

// ── State ─────────────────────────────────────────────────────────────────────
const state = {
  allRecords: [],   // raw records from server
  filtered: [],     // after filters applied
  files: [],
  charts: {},       // keyed by canvas id
  gantt: null
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const show = el => el.classList.remove('hidden');
const hide = el => el.classList.add('hidden');

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || res.statusText);
  return json;
}

// ── Boot ──────────────────────────────────────────────────────────────────────
(async () => {
  try {
    const me = await api('/api/me');
    if (me.authenticated) {
      showApp();
      await loadData();
    } else {
      showLogin();
    }
  } catch {
    showLogin();
  }
})();

// ── Login ─────────────────────────────────────────────────────────────────────
function showLogin() {
  hide($('app'));
  show($('login-screen'));
  $('password-input').focus();
}

function showApp() {
  hide($('login-screen'));
  show($('app'));
}

$('login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const pw = $('password-input').value;
  hide($('login-error'));
  try {
    await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({ password: pw })
    });
    showApp();
    await loadData();
  } catch {
    show($('login-error'));
  }
});

$('logout-btn').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' });
  showLogin();
  state.allRecords = [];
  state.filtered = [];
});

// ── Tab navigation ────────────────────────────────────────────────────────────
document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.tab;
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    $(`tab-${tab}`).classList.add('active');
    if (tab === 'overview')  renderOverview();
    if (tab === 'charts')    renderCharts();
    if (tab === 'gantt')     renderGantt();
    if (tab === 'insights')  renderInsights();
  });
});

// ── File upload ───────────────────────────────────────────────────────────────
const zone = $('upload-zone');
const fileInput = $('file-input');

zone.addEventListener('click', () => fileInput.click());
zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
zone.addEventListener('drop', e => {
  e.preventDefault();
  zone.classList.remove('drag-over');
  handleFiles(e.dataTransfer.files);
});
fileInput.addEventListener('change', () => handleFiles(fileInput.files));

async function handleFiles(fileList) {
  if (!fileList.length) return;
  const status = $('upload-status');
  status.textContent = `Uploading ${fileList.length} file(s)…`;
  show(status);
  status.className = 'upload-status';

  const form = new FormData();
  for (const f of fileList) form.append('files', f);
  const reportType = document.querySelector('input[name="reportType"]:checked')?.value || '';
  if (reportType) form.append('reportType', reportType);

  try {
    const res = await fetch('/api/upload', { method: 'POST', body: form });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error);

    status.textContent = `✓  Loaded ${json.totalRecords} work records from ${json.files.length} file(s).`;
    status.classList.add('success');
    await loadData();
  } catch (err) {
    status.textContent = `Error: ${err.message}`;
    status.classList.add('error');
  }
}

$('clear-data-btn').addEventListener('click', async () => {
  await api('/api/data', { method: 'DELETE' });
  state.allRecords = [];
  state.filtered = [];
  state.files = [];
  renderSidebarFiles();
  renderLoadedFilesList();
  hide($('filters-bar'));
  hide($('upload-status'));
  resetAllCharts();
});

// ── Load data from server ─────────────────────────────────────────────────────
async function loadData() {
  const { records, files } = await api('/api/data');
  state.allRecords = records;
  state.files = files;

  if (records.length) {
    populateFilterOptions();
    applyFilters();
    show($('filters-bar'));
    renderSidebarFiles();
    renderLoadedFilesList();
  } else {
    hide($('filters-bar'));
  }
}

// ── Filters ───────────────────────────────────────────────────────────────────
function populateFilterOptions() {
  const projects    = [...new Set(state.allRecords.map(r => r.project))].sort();
  const employees   = [...new Set(state.allRecords.map(r => r.employee))].sort();
  const subProjects = [...new Set(state.allRecords.map(r => r.subProject))].sort();

  fillSelect('filter-project',    projects);
  fillSelect('filter-employee',   employees);
  fillSelect('filter-subproject', subProjects);

  // Default date range
  const dates = state.allRecords.map(r => r.date).filter(Boolean).sort();
  if (dates.length) {
    $('filter-from').value        = dates[0];
    $('filter-to').value          = dates[dates.length - 1];
    $('upload-filter-from').min   = dates[0];
    $('upload-filter-from').max   = dates[dates.length - 1];
    $('upload-filter-to').min     = dates[0];
    $('upload-filter-to').max     = dates[dates.length - 1];
    $('upload-filter-from').value = dates[0];
    $('upload-filter-to').value   = dates[dates.length - 1];
    updateUploadDateHint();
  }
}

function fillSelect(id, values) {
  const sel = $(id);
  const cur = sel.value;
  sel.innerHTML = '<option value="">All</option>';
  values.forEach(v => {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = v || '(none)';
    sel.appendChild(o);
  });
  if (values.includes(cur)) sel.value = cur;
}

['filter-from','filter-to','filter-project','filter-employee','filter-subproject']
  .forEach(id => $(id).addEventListener('change', () => {
    applyFilters();
    refreshActiveTab();
  }));

$('reset-filters').addEventListener('click', () => {
  populateFilterOptions();
  applyFilters();
  refreshActiveTab();
});

// ── Upload-tab date range ─────────────────────────────────────────────────────
function updateUploadDateHint() {
  const from = $('upload-filter-from').value;
  const to   = $('upload-filter-to').value;
  const hint = $('upload-date-hint');
  if (!from && !to) { hint.textContent = ''; return; }
  const filtered = state.allRecords.filter(r => {
    if (from && r.date && r.date < from) return false;
    if (to   && r.date && r.date > to)   return false;
    return true;
  });
  const hrs = filtered.reduce((s, r) => s + r.hours, 0);
  hint.textContent = `${filtered.length.toLocaleString()} records · ${hrs.toFixed(1)} hours in selected period`;
}

['upload-filter-from', 'upload-filter-to'].forEach(id => {
  $(id).addEventListener('change', () => {
    $('filter-from').value = $('upload-filter-from').value;
    $('filter-to').value   = $('upload-filter-to').value;
    applyFilters();
    updateUploadDateHint();
  });
});

$('upload-reset-dates').addEventListener('click', () => {
  populateFilterOptions();   // resets filter-from / filter-to to full range
  $('upload-filter-from').value = $('filter-from').value;
  $('upload-filter-to').value   = $('filter-to').value;
  applyFilters();
  updateUploadDateHint();
});

function applyFilters() {
  const from       = $('filter-from').value;
  const to         = $('filter-to').value;
  const project    = $('filter-project').value;
  const employee   = $('filter-employee').value;
  const subProject = $('filter-subproject').value;

  state.filtered = state.allRecords.filter(r => {
    if (from && r.date && r.date < from) return false;
    if (to   && r.date && r.date > to)   return false;
    if (project    && r.project    !== project)    return false;
    if (employee   && r.employee   !== employee)   return false;
    if (subProject && r.subProject !== subProject) return false;
    return true;
  });
}

function refreshActiveTab() {
  const active = document.querySelector('.nav-item.active')?.dataset.tab;
  if (active === 'overview') renderOverview();
  if (active === 'charts')   renderCharts();
  if (active === 'gantt')    renderGantt();
}

// ── Sidebar file list ─────────────────────────────────────────────────────────
function renderSidebarFiles() {
  const el = $('sidebar-files');
  if (!state.files.length) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="sidebar-files-title">Loaded files</div>` +
    state.files.map(f =>
      `<div class="sidebar-file-item">
        <span class="sidebar-file-name" title="${f.name}">${f.name}</span>
        <span class="sidebar-file-meta">${f.count} rows</span>
      </div>`
    ).join('');
}

function renderLoadedFilesList() {
  const wrap = $('loaded-files-list');
  const tbl  = $('files-table');
  if (!state.files.length) { hide(wrap); return; }
  show(wrap);
  tbl.innerHTML = `<table class="files-table">
    <thead><tr><th>File</th><th>Type</th><th>Records</th></tr></thead>
    <tbody>
      ${state.files.map(f => `<tr>
        <td>${f.name}</td>
        <td><span class="badge badge-${f.type}">${f.type}</span></td>
        <td>${f.count}</td>
      </tr>`).join('')}
    </tbody>
  </table>`;
}

// ── KPI helpers ───────────────────────────────────────────────────────────────
function aggregate(records, key) {
  const map = {};
  for (const r of records) map[r[key]] = (map[r[key]] || 0) + r.hours;
  return map;
}

function topN(map, n) {
  return Object.entries(map)
    .sort(([, a], [, b]) => b - a)
    .slice(0, n);
}

// ── Overview tab ──────────────────────────────────────────────────────────────
function renderOverview() {
  const r = state.filtered;
  if (!r.length) { setKPIs('—'); return; }

  const totalHours  = r.reduce((s, x) => s + x.hours, 0);
  const employees   = new Set(r.map(x => x.employee)).size;
  const projects    = new Set(r.map(x => x.project)).size;
  const dates       = r.map(x => x.date).filter(Boolean).sort();

  $('kpi-hours').textContent     = totalHours.toFixed(1);
  $('kpi-records').textContent   = r.length.toLocaleString();
  $('kpi-employees').textContent = employees;
  $('kpi-projects').textContent  = projects;
  $('kpi-period').textContent    = dates.length ? `${dates[0]} → ${dates[dates.length-1]}` : '—';
  $('kpi-avg').textContent       = employees ? (totalHours / employees).toFixed(1) : '—';

  const byProject  = topN(aggregate(r, 'project'),  10);
  const byEmployee = topN(aggregate(r, 'employee'), 10);

  buildBarChart('chart-projects-overview',  byProject,  '#6366f1');
  buildBarChart('chart-employees-overview', byEmployee, '#10b981');

  const hasEmployee = state.files.some(f => f.type === 'employee');
  const distRow = $('distribution-row');
  if (hasEmployee) {
    distRow.style.display = '';
    buildDonutChart('chart-dist-customer',    topN(aggregate(r, 'customer'),    12));
    buildDonutChart('chart-dist-project',     topN(aggregate(r, 'project'),     12));
    buildDonutChart('chart-dist-subproject',  topN(aggregate(r, 'subProject'),  12));
  } else {
    distRow.style.display = 'none';
    ['chart-dist-customer','chart-dist-project','chart-dist-subproject'].forEach(destroyChart);
  }
}

function setKPIs(v) {
  ['kpi-hours','kpi-records','kpi-employees','kpi-projects','kpi-period','kpi-avg']
    .forEach(id => $(id).textContent = v);
}

// ── Charts tab ────────────────────────────────────────────────────────────────
function renderCharts() {
  const r = state.filtered;
  if (!r.length) return;

  // Monthly trend (line chart)
  const monthly = {};
  r.forEach(x => {
    if (!x.date) return;
    const m = x.date.slice(0, 7);
    monthly[m] = (monthly[m] || 0) + x.hours;
  });
  const months = Object.entries(monthly).sort(([a], [b]) => a.localeCompare(b));
  buildLineChart('chart-monthly', months);

  // Sub-project bar
  const bySub = topN(aggregate(r, 'subProject'), 15);
  buildBarChart('chart-subprojects', bySub, '#f59e0b');

  // Employee × project stacked bar (heatmap proxy)
  buildStackedBar('chart-heatmap', r);
}

// ── Gantt tab ─────────────────────────────────────────────────────────────────
function renderGantt() {
  const r = state.filtered;
  const container = $('gantt-container');
  const emptyMsg  = $('gantt-empty');
  const groupBy   = $('gantt-group').value;
  const viewMode  = $('gantt-view').value;

  if (!r.length) {
    container.innerHTML = '';
    show(emptyMsg);
    return;
  }
  hide(emptyMsg);

  // Build date ranges per group key
  const ranges = {};
  r.forEach(x => {
    const key = x[groupBy] || '(none)';
    if (!x.date) return;
    if (!ranges[key]) ranges[key] = { start: x.date, end: x.date, hours: 0 };
    if (x.date < ranges[key].start) ranges[key].start = x.date;
    if (x.date > ranges[key].end)   ranges[key].end   = x.date;
    ranges[key].hours += x.hours;
  });

  const tasks = Object.entries(ranges).map(([name, { start, end, hours }], i) => ({
    id:       String(i),
    name:     `${name} (${hours.toFixed(0)}h)`,
    start,
    end:      end >= start ? end : start,  // Frappe requires end ≥ start
    progress: 100,
    dependencies: ''
  }));

  container.innerHTML = '';

  try {
    state.gantt = new Gantt('#gantt-container', tasks, {
      view_mode: viewMode,
      date_format: 'YYYY-MM-DD',
      bar_height: 28,
      padding: 18,
      on_click: () => {}
    });
  } catch (e) {
    container.innerHTML = `<p class="error-msg">Gantt error: ${e.message}</p>`;
  }
}

$('gantt-group').addEventListener('change', renderGantt);
$('gantt-view').addEventListener('change', () => {
  if (state.gantt) state.gantt.change_view_mode($('gantt-view').value);
});

// ── Insights tab ─────────────────────────────────────────────────────────────

function renderInsights() {
  const r = state.filtered;
  const empty = $('insights-empty');
  const grid  = $('insights-grid');

  if (!r.length) { show(empty); grid.innerHTML = ''; return; }
  hide(empty);

  const totalHours  = r.reduce((s, x) => s + x.hours, 0);
  const byEmployee  = aggregate(r, 'employee');
  const byProject   = aggregate(r, 'project');
  const bySubProject= aggregate(r, 'subProject');
  const numEmployees= Object.keys(byEmployee).length;
  const avgHours    = totalHours / numEmployees;

  // Working days per employee
  const empDays = {};
  r.forEach(x => {
    if (!empDays[x.employee]) empDays[x.employee] = new Set();
    if (x.date) empDays[x.employee].add(x.date);
  });

  // Monthly hours per employee
  const empMonthly = {};
  r.forEach(x => {
    if (!x.date) return;
    const m = x.date.slice(0, 7);
    if (!empMonthly[x.employee]) empMonthly[x.employee] = {};
    empMonthly[x.employee][m] = (empMonthly[x.employee][m] || 0) + x.hours;
  });

  // Monthly totals for trend
  const monthly = {};
  r.forEach(x => {
    if (!x.date) return;
    const m = x.date.slice(0, 7);
    monthly[m] = (monthly[m] || 0) + x.hours;
  });
  const monthEntries = Object.entries(monthly).sort(([a], [b]) => a.localeCompare(b));

  // Trend: compare first half vs second half
  let trend = 'stable', trendIcon = '➡️', trendColor = 'neutral';
  if (monthEntries.length >= 2) {
    const mid   = Math.floor(monthEntries.length / 2);
    const first = monthEntries.slice(0, mid).reduce((s, [, h]) => s + h, 0) / mid;
    const last  = monthEntries.slice(mid).reduce((s, [, h]) => s + h, 0) / (monthEntries.length - mid);
    if (last > first * 1.15)       { trend = 'Growing';   trendIcon = '📈'; trendColor = 'warn'; }
    else if (last < first * 0.85)  { trend = 'Declining'; trendIcon = '📉'; trendColor = 'info'; }
    else                           { trend = 'Stable';    trendIcon = '➡️'; trendColor = 'neutral'; }
  }

  // Overallocated: > 160h in any single month
  const overloaded = [];
  Object.entries(empMonthly).forEach(([emp, months]) => {
    Object.entries(months).forEach(([month, hours]) => {
      if (hours > 160) overloaded.push({ emp, month, hours: hours.toFixed(1) });
    });
  });

  // Underutilised: below 30% of team average
  const underused = Object.entries(byEmployee)
    .filter(([, h]) => h < avgHours * 0.3)
    .sort(([, a], [, b]) => a - b);

  // Top project's share
  const topProj   = topN(byProject, 3);
  const topEmp    = topN(byEmployee, 3);
  const topSub    = topN(bySubProject, 1)[0];
  const topProjPct= topProj[0] ? ((topProj[0][1] / totalHours) * 100).toFixed(0) : 0;

  // Avg hours per active day per employee
  const empAvgDay = Object.entries(byEmployee).map(([emp, h]) => ({
    emp, h: h.toFixed(1),
    days: empDays[emp]?.size || 1,
    avg: (h / (empDays[emp]?.size || 1)).toFixed(1)
  })).sort((a, b) => b.h - a.h);

  const cards = [
    // Workload summary
    {
      color: 'blue',
      title: 'Workload summary',
      icon: '📊',
      rows: [
        `Total hours logged: <strong>${totalHours.toFixed(1)}h</strong>`,
        `Across <strong>${numEmployees}</strong> employee${numEmployees > 1 ? 's' : ''} and <strong>${Object.keys(byProject).length}</strong> project${Object.keys(byProject).length > 1 ? 's' : ''}`,
        `Team average: <strong>${avgHours.toFixed(1)}h</strong> per employee`
      ]
    },

    // Monthly trend
    {
      color: trendColor,
      title: 'Monthly trend',
      icon: trendIcon,
      rows: [
        `Workload is <strong>${trend}</strong> across ${monthEntries.length} month${monthEntries.length > 1 ? 's' : ''}`,
        ...monthEntries.map(([m, h]) => `${m}: <strong>${h.toFixed(1)}h</strong>`)
      ]
    },

    // Top projects
    {
      color: 'blue',
      title: 'Top projects by hours',
      icon: '🏆',
      rows: topProj.map(([name, h], i) =>
        `${i + 1}. <strong>${name || '(none)'}</strong> — ${h.toFixed(1)}h (${((h / totalHours) * 100).toFixed(0)}%)`
      )
    },

    // Top employees
    {
      color: 'blue',
      title: 'Top employees by hours',
      icon: '👤',
      rows: empAvgDay.slice(0, 5).map((e, i) =>
        `${i + 1}. <strong>${e.emp}</strong> — ${e.h}h over ${e.days} day${e.days > 1 ? 's' : ''} (avg ${e.avg}h/day)`
      )
    },

    // Concentration risk
    {
      color: +topProjPct > 60 ? 'warn' : 'green',
      title: 'Project concentration',
      icon: +topProjPct > 60 ? '⚠️' : '✅',
      rows: topProj[0] ? [
        `"<strong>${topProj[0][0]}</strong>" accounts for <strong>${topProjPct}%</strong> of all hours`,
        +topProjPct > 60
          ? 'High concentration — consider whether this is intentional'
          : 'Hours are reasonably spread across projects'
      ] : ['Not enough data']
    },

    // Overallocation
    overloaded.length ? {
      color: 'red',
      title: 'Potential overallocation',
      icon: '🔴',
      rows: [
        'Employees exceeding 160h in a single month:',
        ...overloaded.map(o => `<strong>${o.emp}</strong> — ${o.hours}h in ${o.month}`)
      ]
    } : {
      color: 'green',
      title: 'No overallocation detected',
      icon: '✅',
      rows: ['No employee exceeded 160h in any single month']
    },

    // Underutilisation
    underused.length ? {
      color: 'warn',
      title: 'Low utilisation',
      icon: '⚠️',
      rows: [
        `Below 30% of team average (${avgHours.toFixed(1)}h):`,
        ...underused.map(([emp, h]) => `<strong>${emp}</strong> — ${h.toFixed(1)}h`)
      ]
    } : {
      color: 'green',
      title: 'Utilisation looks balanced',
      icon: '✅',
      rows: ['No employees are significantly below the team average']
    },

    // Top sub-project
    topSub ? {
      color: 'blue',
      title: 'Busiest sub-project',
      icon: '🔍',
      rows: [
        `"<strong>${topSub[0]}</strong>" — ${topSub[1].toFixed(1)}h (${((topSub[1] / totalHours) * 100).toFixed(0)}% of total)`
      ]
    } : null

  ].filter(Boolean);

  grid.innerHTML = cards.map(c => `
    <div class="insight-card insight-card--${c.color}">
      <div class="insight-card-header">
        <span class="insight-icon">${c.icon}</span>
        <span class="insight-title">${c.title}</span>
      </div>
      <ul class="insight-rows">
        ${c.rows.map(row => `<li>${row}</li>`).join('')}
      </ul>
    </div>
  `).join('');
}

// ── Chart builders ────────────────────────────────────────────────────────────
const PALETTE = [
  '#6366f1','#10b981','#f59e0b','#ef4444','#3b82f6',
  '#8b5cf6','#06b6d4','#f97316','#84cc16','#ec4899',
  '#14b8a6','#a78bfa','#fb923c','#4ade80','#38bdf8'
];

// Register datalabels plugin but keep it off by default — each chart opts in
Chart.register(ChartDataLabels);
Chart.defaults.set('plugins.datalabels', { display: false });

function destroyChart(id) {
  if (state.charts[id]) {
    state.charts[id].destroy();
    delete state.charts[id];
  }
}

function resetAllCharts() {
  Object.keys(state.charts).forEach(id => {
    state.charts[id].destroy();
    delete state.charts[id];
  });
}

function buildBarChart(id, data, color) {
  destroyChart(id);
  const canvas = $(id);
  if (!canvas || !data.length) return;
  const total = data.reduce((s, [, v]) => s + v, 0);
  state.charts[id] = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: data.map(([k]) => k || '(none)'),
      datasets: [{ label: 'Hours', data: data.map(([, v]) => +v.toFixed(1)), backgroundColor: color }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { right: 52 } },
      plugins: {
        legend: { display: false },
        datalabels: {
          display: true,
          anchor: 'end',
          align: 'right',
          color: '#6b7280',
          font: { size: 11 },
          formatter: v => `${((v / total) * 100).toFixed(1)}%`
        }
      },
      scales: { x: { beginAtZero: true } }
    }
  });
}

function buildDonutChart(id, data) {
  destroyChart(id);
  const canvas = $(id);
  if (!canvas || !data.length) return;
  const total = data.reduce((s, [, v]) => s + v, 0);
  state.charts[id] = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: data.map(([k]) => k || '(none)'),
      datasets: [{ data: data.map(([, v]) => +v.toFixed(1)), backgroundColor: PALETTE }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '60%',
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } },
        datalabels: {
          display: ctx => (ctx.dataset.data[ctx.dataIndex] / total) >= 0.04,
          color: '#fff',
          font: { size: 11, weight: 'bold' },
          formatter: (v) => `${((v / total) * 100).toFixed(0)}%`
        }
      }
    }
  });
}

function buildLineChart(id, data) {
  destroyChart(id);
  const canvas = $(id);
  if (!canvas || !data.length) return;
  state.charts[id] = new Chart(canvas, {
    type: 'line',
    data: {
      labels: data.map(([k]) => k),
      datasets: [{
        label: 'Hours',
        data: data.map(([, v]) => +v.toFixed(1)),
        borderColor: '#6366f1',
        backgroundColor: 'rgba(99,102,241,0.12)',
        tension: 0.3,
        fill: true,
        pointRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: 24 } },
      plugins: {
        legend: { display: false },
        datalabels: {
          display: true,
          anchor: 'end',
          align: 'top',
          color: '#6366f1',
          font: { size: 11, weight: 'bold' },
          formatter: (v, ctx) => {
            const total = ctx.dataset.data.reduce((s, x) => s + (x || 0), 0);
            const pct = total > 0 ? ((v / total) * 100).toFixed(0) : 0;
            return `${v}h (${pct}%)`;
          }
        }
      },
      scales: { y: { beginAtZero: true } }
    }
  });
}

function buildStackedBar(id, records) {
  destroyChart(id);
  const canvas = $(id);
  if (!canvas) return;

  // employees (rows) × projects (stacks) — top 8 employees, top 8 projects
  const empMap  = aggregate(records, 'employee');
  const projMap = aggregate(records, 'project');
  const topEmps  = topN(empMap, 8).map(([k]) => k);
  const topProjs = topN(projMap, 8).map(([k]) => k);

  const datasets = topProjs.map((proj, i) => ({
    label: proj || '(none)',
    data: topEmps.map(emp => {
      const h = records
        .filter(r => r.employee === emp && r.project === proj)
        .reduce((s, r) => s + r.hours, 0);
      return +h.toFixed(1);
    }),
    backgroundColor: PALETTE[i % PALETTE.length]
  }));

  state.charts[id] = new Chart(canvas, {
    type: 'bar',
    data: { labels: topEmps, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12 } },
        datalabels: {
          // Only draw on the topmost (last) dataset so the label sits above the full bar
          display: ctx => ctx.datasetIndex === ctx.chart.data.datasets.length - 1,
          anchor: 'end',
          align: 'end',
          color: '#374151',
          font: { size: 11, weight: 'bold' },
          formatter: (_, ctx) => {
            const empTotal = ctx.chart.data.datasets
              .reduce((s, ds) => s + (ds.data[ctx.dataIndex] || 0), 0);
            const grandTotal = ctx.chart.data.datasets
              .reduce((s, ds) => s + ds.data.reduce((a, b) => a + (b || 0), 0), 0);
            const pct = grandTotal > 0 ? ((empTotal / grandTotal) * 100).toFixed(0) : 0;
            return `${empTotal.toFixed(0)}h (${pct}%)`;
          }
        }
      },
      scales: {
        x: { stacked: true },
        y: { stacked: true, beginAtZero: true }
      }
    }
  });
}
