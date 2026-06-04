const XLSX = require('xlsx');

// Employee report column indices (11-col layout — fixed format)
// Header: סה"כ | ק"מ | יעד | שעות נסיעה | שעות בלתי נמנע | שעות עבודה | תת פרוייקט | פרוייקט | לקוח | תאריך | עובד
const EMPLOYEE_COL = {
  TOTAL_HOURS: 0,
  HOURS:       5,
  SUB_PROJECT: 6,
  PROJECT:     7,
  CUSTOMER:    8,
  DATE:        9,
  EMPLOYEE:    10
};

// Parse "DD/MM/YYYY" → Date (returns null on failure)
function parseDate(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const [d, m, y] = raw.split('/');
  if (!d || !m || !y) return null;
  const dt = new Date(+y, +m - 1, +d);
  return isNaN(dt.getTime()) ? null : dt;
}

function toISODate(dt) {
  if (!dt) return null;
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Build a column-index map by scanning the header row for known Hebrew labels.
// This handles any variant of the Admiral project/customer export format.
function buildProjectColMap(rows) {
  for (let i = 0; i < Math.min(6, rows.length); i++) {
    const row = rows[i];
    if (!Array.isArray(row) || !row.includes('תאריך')) continue;

    const map = { dataStart: i + 1 };
    row.forEach((cell, idx) => {
      const v = String(cell || '').trim();
      if (v === 'תאריך')          map.DATE        = idx;
      if (v === 'עובד')           map.EMPLOYEE    = idx;
      if (v === 'לקוח')           map.CUSTOMER    = idx;
      if (v === 'פרוייקט')        map.PROJECT     = idx;
      if (v === 'תת פרוייקט')     map.SUB_PROJECT = idx;
      if (v === 'תאור')           map.DESCRIPTION = idx;
      // Match exactly "שעות" (work hours), not "שעות נסיעה" / "שעות בלתי נמנע"
      if (v === 'שעות')           map.HOURS       = idx;
      if (v === 'סה"כ שעות' || v === 'סה\'\'כ שעות') map.TOTAL_HOURS = idx;
    });
    return map;
  }
  return null;
}

// Project/Customer report: hierarchy is Customer → Project → SubProject → leaf work records.
// Leaf rows are identified by having a date value. Column positions are read dynamically.
function parseProjectRows(rows) {
  const C = buildProjectColMap(rows);
  if (!C || C.DATE == null) return [];

  const records = [];
  let customer = '', project = '', subProject = '';

  for (let i = C.dataStart; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every(v => v == null || v === '')) continue;

    const rawCustomer   = C.CUSTOMER    != null ? row[C.CUSTOMER]    : null;
    const rawProject    = C.PROJECT     != null ? row[C.PROJECT]     : null;
    const rawSubProject = C.SUB_PROJECT != null ? row[C.SUB_PROJECT] : null;
    const rawDate       = row[C.DATE];
    const rawEmployee   = C.EMPLOYEE    != null ? row[C.EMPLOYEE]    : null;

    if (rawCustomer) {
      customer   = String(rawCustomer).trim();
      project    = '';
      subProject = '';
    } else if (rawProject) {
      project    = String(rawProject).trim();
      subProject = '';
    } else if (rawSubProject && !rawDate) {
      // Sub-project context row (skip employee subtotals that also have sub-project filled)
      if (!rawEmployee) subProject = String(rawSubProject).trim();
    } else if (rawDate) {
      // Leaf work record
      const hoursCol  = C.HOURS       != null ? row[C.HOURS]       : null;
      const totalCol  = C.TOTAL_HOURS != null ? row[C.TOTAL_HOURS] : null;
      const hours = typeof hoursCol === 'number' ? hoursCol
        : typeof totalCol  === 'number' ? totalCol
        : parseFloat(hoursCol || totalCol) || 0;

      const dt = parseDate(String(rawDate));
      if (!dt) continue;

      const desc = C.DESCRIPTION != null ? row[C.DESCRIPTION] : null;
      records.push({
        customer,
        project,
        subProject: rawSubProject ? String(rawSubProject).trim() : subProject,
        task:       String(desc || '').replace(/\s+/g, ' ').trim(),
        employee:   rawEmployee ? String(rawEmployee).trim() : '',
        date:       toISODate(dt),
        hours
      });
    }
  }

  return records;
}

// Employee report: hierarchy is Employee → Date → leaf work record (customer/project/subProject)
function parseEmployeeRows(rows) {
  const records = [];
  const C = EMPLOYEE_COL;

  let dataStart = 3;
  for (let i = 0; i < Math.min(6, rows.length); i++) {
    if (Array.isArray(rows[i]) && rows[i].includes('תאריך')) {
      dataStart = i + 1;
      break;
    }
  }

  let employee = '', date = null;

  for (let i = dataStart; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every(v => v == null || v === '')) continue;

    const rawEmployee   = row[C.EMPLOYEE];
    const rawDate       = row[C.DATE];
    const rawSubProject = row[C.SUB_PROJECT];
    const rawProject    = row[C.PROJECT];
    const rawCustomer   = row[C.CUSTOMER];

    if (rawEmployee && !rawDate && !rawSubProject && !rawProject && !rawCustomer) {
      employee = String(rawEmployee).trim();
      date = null;
    } else if (rawDate && !rawEmployee && !rawSubProject && !rawProject && !rawCustomer) {
      const dt = parseDate(String(rawDate));
      date = dt ? toISODate(dt) : null;
    } else if ((rawSubProject || rawProject || rawCustomer) && !rawDate && !rawEmployee) {
      // Skip Admiral grand-total footer rows
      if (String(rawSubProject || rawProject || rawCustomer).startsWith('סה"כ') ||
          String(rawSubProject || rawProject || rawCustomer).startsWith("סה\"כ")) continue;
      const hours = typeof row[C.HOURS] === 'number'
        ? row[C.HOURS]
        : parseFloat(row[C.HOURS]) || 0;

      records.push({
        customer:   String(rawCustomer  || '').trim(),
        project:    String(rawProject   || '').trim(),
        subProject: String(rawSubProject|| '').trim(),
        task:       '',
        employee,
        date,
        hours
      });
    }
  }

  return records;
}

// Detect report type from the Hebrew title row (row index 1).
// "דוח שעות על פי עובד" → employee
// "דוח פרוייקטים" / "דוח שעות על פי פרוייקט" → project
function detectType(titleRow, typeOverrideHint) {
  if (typeOverrideHint) return typeOverrideHint;
  const title = String(titleRow?.[0] || '').toLowerCase();
  if (title.includes('עובד') || title.includes('employee')) return 'employee';
  if (title.includes('לקוח') || title.includes('customer')) return 'customer';
  return 'project';
}

const VALID_TYPES = new Set(['project', 'employee', 'customer']);

function parseExcelFile(buffer, filename, typeOverride) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

  const manualOverride = (typeOverride && VALID_TYPES.has(typeOverride)) ? typeOverride : null;
  const type = detectType(rows[1], manualOverride);

  const records = type === 'employee'
    ? parseEmployeeRows(rows)
    : parseProjectRows(rows);

  return { filename, type, sheetName, records };
}

module.exports = { parseExcelFile };
