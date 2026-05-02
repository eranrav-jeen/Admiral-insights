const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Build a compact summary of the dataset so we stay well within the context limit
function buildSummary(records) {
  const byEmployee  = {};
  const byProject   = {};
  const bySubProject = {};
  const byMonth     = {};

  let totalHours = 0;
  let minDate = '9999-99-99';
  let maxDate = '0000-00-00';

  for (const r of records) {
    totalHours += r.hours;
    byEmployee[r.employee]    = (byEmployee[r.employee]   || 0) + r.hours;
    byProject[r.project]      = (byProject[r.project]     || 0) + r.hours;
    bySubProject[r.subProject]= (bySubProject[r.subProject]||0) + r.hours;

    if (r.date) {
      const month = r.date.slice(0, 7); // "YYYY-MM"
      byMonth[month] = (byMonth[month] || 0) + r.hours;
      if (r.date < minDate) minDate = r.date;
      if (r.date > maxDate) maxDate = r.date;
    }
  }

  const top = (obj, n = 15) =>
    Object.entries(obj)
      .sort(([, a], [, b]) => b - a)
      .slice(0, n)
      .map(([k, v]) => `  ${k}: ${v.toFixed(1)}h`)
      .join('\n');

  const months = Object.entries(byMonth)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([m, h]) => `  ${m}: ${h.toFixed(1)}h`)
    .join('\n');

  return `Period: ${minDate} → ${maxDate}
Total hours: ${totalHours.toFixed(1)}
Total records: ${records.length}
Employees: ${Object.keys(byEmployee).length}
Projects: ${Object.keys(byProject).length}

Hours by employee (top 15):
${top(byEmployee)}

Hours by project (top 15):
${top(byProject)}

Hours by sub-project (top 15):
${top(bySubProject)}

Monthly trend:
${months}`;
}

async function generateInsights(records, question) {
  const summary = buildSummary(records);

  const systemPrompt = `You are a project-management analyst reviewing work-hour exports from Admiral, a manpower management system.
Your audience is team managers at a professional services / consulting firm (JEEN.AI).
Respond in the same language used in the data (Hebrew if the employee/project names are in Hebrew, otherwise English).
Be specific and actionable. Use bullet points. Keep the total response under 400 words.`;

  const userContent = question
    ? `Here is the data summary:\n\n${summary}\n\nQuestion: ${question}`
    : `Here is the data summary:\n\n${summary}\n\nPlease provide:
1. Key workload trends and observations
2. Employees or projects showing potential overallocation (unusually high hours)
3. Underutilized resources if any
4. The top 3 projects or tasks consuming the most hours, and whether that looks healthy
5. One actionable recommendation for the team manager`;

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: 'user', content: userContent }]
  });

  return message.content[0].text;
}

module.exports = { generateInsights };
