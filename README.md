# Admiral Insights

Internal analytics dashboard for Admiral manpower-management Excel exports.
Parses hierarchical project/employee reports, displays charts and a Gantt
timeline, and generates AI-powered insights via Claude.

---

## Quick start (local)

```bash
# 1. Install dependencies
npm install

# 2. Create your .env
cp .env.example .env
# → edit .env: set PASSWORD, ANTHROPIC_API_KEY, SESSION_SECRET

# 3. Run
npm run dev        # nodemon (hot-reload)
# or
npm start          # plain node

# App is at http://localhost:3000
```

---

## Deployment (Linux server with pm2 + nginx)

### 1. Clone & install

```bash
cd /var/www
git clone https://github.com/eranrav-jeen/Admiral-insights.git admiral-insights
cd admiral-insights
npm install --production
cp .env.example .env
nano .env          # fill in secrets
mkdir -p logs
```

### 2. Start with pm2

```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup        # follow the printed command to enable auto-start on boot
```

### 3. Configure nginx

Copy the block from `nginx.conf` into your nginx config, update `server_name`,
then:

```bash
nginx -t && systemctl reload nginx
```

---

## Excel report formats

The parser handles the **hierarchical** Admiral export layout.

### Project report (`Rep_Hours_By_Project`)
Hierarchy: **Customer → Project → Sub-project → work records**

Each work-record row contains: description, employee, date (DD/MM/YYYY), hours.

### Employee report (`Rep_Hours_By_Employee`)
Same column layout; top-level grouping is Employee instead of Customer.

Both formats are auto-detected from the sheet name and first data row.

---

## Environment variables

| Variable          | Description                                          |
|-------------------|------------------------------------------------------|
| `PASSWORD`        | Shared login password (no user accounts)             |
| `SESSION_SECRET`  | Random string for signing session cookies            |
| `PORT`            | Port to listen on (default `3000`)                   |

---

## Tech stack

| Layer      | Library                                  |
|------------|------------------------------------------|
| Backend    | Node.js + Express + express-session      |
| Excel      | SheetJS (xlsx)                           |
| Charts     | Chart.js 4 + chartjs-adapter-date-fns    |
| Gantt      | Frappe Gantt 0.6                         |
| Process    | pm2                                      |
| Proxy      | nginx                                    |
