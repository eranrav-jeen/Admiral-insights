const XLSX = require('xlsx');

// Column indices in the Admiral hierarchical export (RTL Hebrew layout stored LTR)
const COL = {
  TOTAL_HOURS: 0,  // סה"כ שעות
  HOURS:       4,  // שעות
  DESCRIPTION: 6,  // תאור
  EMPLOYEE:    7,  // עובד
  DATE:        8,  // תאריך  DD/MM/YYYY
  SUB_PROJECT: 9,  // תת פרוייקט
  PROJECT:     10, // פרוייקט
  CUSTOMER:    11  // לקוח
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

// Walk through the hierarchical rows, tracking the Customer→Project→SubProject context.
// A row is a "leaf" work record when it has a date and an employee name.
function parseHierarchicalRows(rows) {
  const records = [];

  // Find header row (contains "תאריך") and start parsing from the next line
  let dataStart = 3;
  for (let i = 0; i < Math.min(6, rows.length); i++) {
    if (Array.isArray(rows[i]) && rows[i].includes('תאריך')) {
      dataStart = i + 1;
      break;
    }
  }

  let customer = '';
  let project = '';
  let subProject = '';

  for (let i = dataStart; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every(v => v == null || v === '')) continue;

    const rawCustomer    = row[COL.CUSTOMER];
    const rawProject     = row[COL.PROJECT];
    const rawSubProject  = row[COL.SUB_PROJECT];
    const rawDate        = row[COL.DATE];
    const rawEmployee    = row[COL.EMPLOYEE];

    if (rawCustomer) {
      // Customer-level subtotal row → update context
      customer   = String(rawCustomer).trim();
      project    = '';
      subProject = '';
    } else if (rawProject) {
      // Project-level subtotal row
      project    = String(rawProject).trim();
      subProject = '';
    } else if (rawSubProject) {
      // Sub-project-level subtotal row
      subProject = String(rawSubProject).trim();
    } else if (rawDate && rawEmployee) {
      // Leaf work record
      const hours = typeof row[COL.HOURS] === 'number'
        ? row[COL.HOURS]
        : typeof row[COL.TOTAL_HOURS] === 'number'
          ? row[COL.TOTAL_HOURS]
          : parseFloat(row[COL.HOURS] || row[COL.TOTAL_HOURS]) || 0;

      const dt = parseDate(String(rawDate));
      if (!dt) continue;

      records.push({
        customer,
        project,
        subProject,
        task:     String(row[COL.DESCRIPTION] || '').replace(/\s+/g, ' ').trim(),
        employee: String(rawEmployee).trim(),
        date:     toISODate(dt),       // "YYYY-MM-DD" — easy to sort & filter
        hours
      });
    }
  }

  return records;
}

// Detect whether this is a Project report or an Employee report.
// Both use the same column layout; the difference is which level sits at the top
// of the hierarchy (Customer/Project vs Employee).
function detectType(sheetName, firstDataRow) {
  if (!firstDataRow) return 'project';
  // Employee report: top-level grouping is employee (col 7 populated, others empty)
  if (firstDataRow[COL.EMPLOYEE] && !firstDataRow[COL.CUSTOMER] && !firstDataRow[COL.PROJECT]) {
    return 'employee';
  }
  const name = (sheetName || '').toLowerCase();
  if (name.includes('employee') || name.includes('עובד')) return 'employee';
  return 'project';
}

function parseExcelFile(buffer, filename) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

  // First data row is rows[3] (after 2 metadata rows + 1 header row)
  const type = detectType(sheetName, rows[3]);
  const records = parseHierarchicalRows(rows);

  return { filename, type, sheetName, records };
}

module.exports = { parseExcelFile };
