const XLSX = require('xlsx');

// Project report column indices (16-col layout)
// Header: ק"מ | תאור | יעד | עד שעה | משעה | שעות נסיעה | שעות | יום | תאריך | סה"כ שעות | עובד | תת פרוייקט | פרוייקט | לקוח
const PROJECT_COL = {
  DESCRIPTION: 1,
  HOURS:       6,
  DATE:        8,
  TOTAL_HOURS: 9,
  EMPLOYEE:    10,
  SUB_PROJECT: 11,
  PROJECT:     12,
  CUSTOMER:    13,
};

// Employee report column indices (11-col layout)
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

// Project/Customer report: hierarchy is Customer → Project → SubProject → Employee subtotal → leaf
// Leaf rows are identified by having a date (col 8).
function parseProjectRows(rows) {
  const records = [];
  const C = PROJECT_COL;

  let dataStart = 3;
  for (let i = 0; i < Math.min(6, rows.length); i++) {
    if (Array.isArray(rows[i]) && rows[i].includes('תאריך')) {
      dataStart = i + 1;
      break;
    }
  }

  let customer = '', project = '', subProject = '';

  for (let i = dataStart; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every(v => v == null || v === '')) continue;

    const rawCustomer   = row[C.CUSTOMER];
    const rawProject    = row[C.PROJECT];
    const rawSubProject = row[C.SUB_PROJECT];
    const rawDate       = row[C.DATE];
    const rawEmployee   = row[C.EMPLOYEE];

    if (rawCustomer) {
      customer   = String(rawCustomer).trim();
      project    = '';
      subProject = '';
    } else if (rawProject) {
      project    = String(rawProject).trim();
      subProject = '';
    } else if (rawSubProject && !rawDate) {
      // Sub-project context row (employee subtotals also have sub-project filled, skip those too)
      if (!rawEmployee) subProject = String(rawSubProject).trim();
    } else if (rawDate) {
      // Leaf work record
      const hours = typeof row[C.HOURS] === 'number'
        ? row[C.HOURS]
        : typeof row[C.TOTAL_HOURS] === 'number'
          ? row[C.TOTAL_HOURS]
          : parseFloat(row[C.HOURS] || row[C.TOTAL_HOURS]) || 0;

      const dt = parseDate(String(rawDate));
      if (!dt) continue;

      records.push({
        customer,
        project,
        subProject: rawSubProject ? String(rawSubProject).trim() : subProject,
        task:       String(row[C.DESCRIPTION] || '').replace(/\s+/g, ' ').trim(),
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
      // Employee header row
      employee = String(rawEmployee).trim();
      date = null;
    } else if (rawDate && !rawEmployee && !rawSubProject && !rawProject && !rawCustomer) {
      // Date context row
      const dt = parseDate(String(rawDate));
      date = dt ? toISODate(dt) : null;
    } else if ((rawSubProject || rawProject || rawCustomer) && !rawDate && !rawEmployee) {
      // Leaf work record — skip Admiral grand-total footer rows
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

// Detect report type from the title row (row index 1).
// Employee report title: "דוח שעות על פי עובד"
// Project report title:  "דוח פרוייקטים"
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
