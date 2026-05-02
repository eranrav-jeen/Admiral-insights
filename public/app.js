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
    $('filter-from').value = dates[0];
    $('filter-to').value   = dates[dates.length - 1];
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

// ── Chart builders ────────────────────────────────────────────────────────────
const PALETTE = [
  '#6366f1','#10b981','#f59e0b','#ef4444','#3b82f6',
  '#8b5cf6','#06b6d4','#f97316','#84cc16','#ec4899',
  '#14b8a6','#a78bfa','#fb923c','#4ade80','#38bdf8'
];

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
      plugins: { legend: { display: false } },
      scales: { x: { beginAtZero: true } }
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
      plugins: { legend: { display: false } },
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
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } } },
      scales: {
        x: { stacked: true },
        y: { stacked: true, beginAtZero: true }
      }
    }
  });
}
