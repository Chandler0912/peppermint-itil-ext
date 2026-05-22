const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'peppermint',
  user: process.env.DB_USER || 'peppermint',
  password: process.env.DB_PASSWORD || 'a8facd79324412658aa2aa6c1ae34c22',
});

// ========== ITIL 优先级矩阵 ==========
const PRIORITY_MATRIX = {
  5: { 5: 1, 4: 1, 3: 2, 2: 2, 1: 3 },
  4: { 5: 1, 4: 2, 3: 2, 2: 3, 1: 3 },
  3: { 5: 2, 4: 2, 3: 3, 2: 3, 1: 4 },
  2: { 5: 2, 4: 3, 3: 3, 2: 4, 1: 4 },
  1: { 5: 3, 4: 3, 3: 4, 2: 4, 1: 5 },
};

const SLA_TARGETS = {
  1: { response: 15, resolve: 240 },
  2: { response: 30, resolve: 480 },
  3: { response: 120, resolve: 1440 },
  4: { response: 240, resolve: 2880 },
  5: { response: 480, resolve: 7200 },
};

function calcPriority(impact, urgency) {
  return PRIORITY_MATRIX[Math.max(1, Math.min(5, impact))][Math.max(1, Math.min(5, urgency))];
}

function calcSLA(priority, type = 'resolve') {
  const mins = SLA_TARGETS[priority]?.[type] || 1440;
  return new Date(Date.now() + mins * 60000);
}

// ========== GET: 工单 ITIL 面板数据 ==========
app.get('/api/itil/tickets', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, title, status, priority, "itilCategory", impact, urgency, "priorityCalc",
             "ciName", "closureCode", "firstResponse", "slaDeadline", "slaBreached",
             "createdAt", "updatedAt",
             "assignedToName", "clientName"
      FROM "Ticket" t
      LEFT JOIN (SELECT id as uid, name as "assignedToName" FROM "User") u ON t."userId" = u.uid
      LEFT JOIN (SELECT id as cid, name as "clientName" FROM "Client") c ON t."clientId" = c.cid
      ORDER BY "priorityCalc" ASC NULLS LAST, "createdAt" DESC
      LIMIT 100
    `);
    
    const now = new Date();
    const enriched = result.rows.map(t => {
      let slaStatus = 'ok';
      let remainingMin = null;
      if (t.slaDeadline) {
        remainingMin = Math.round((new Date(t.slaDeadline) - now) / 60000);
        if (t.slaBreached) slaStatus = 'breached';
        else if (remainingMin < 30 && remainingMin > 0) slaStatus = 'warning';
        else if (remainingMin <= 0) slaStatus = 'breached';
      }
      return { ...t, slaStatus, remainingMinutes: remainingMin };
    });

    res.json({ success: true, tickets: enriched });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ========== PUT: 更新 ITIL 字段 ==========
app.put('/api/itil/ticket/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { itilCategory, impact, urgency, ciName } = req.body;

    const updates = {};
    if (itilCategory) updates.itilCategory = itilCategory;
    if (impact) updates.impact = impact;
    if (urgency) updates.urgency = urgency;
    if (ciName !== undefined) updates.ciName = ciName;

    // 自动计算优先级
    if (impact || urgency) {
      const cur = await pool.query('SELECT impact, urgency FROM "Ticket" WHERE id = $1', [id]);
      const imp = impact || cur.rows[0]?.impact || 2;
      const urg = urgency || cur.rows[0]?.urgency || 2;
      updates.priorityCalc = calcPriority(Number(imp), Number(urg));
      updates.slaDeadline = calcSLA(updates.priorityCalc);
    }

    const sets = Object.entries(updates).map(([k, v], i) => `"${k}" = $${i + 2}`).join(', ');
    const vals = Object.values(updates);
    
    await pool.query(
      `UPDATE "Ticket" SET ${sets} WHERE id = $1`,
      [id, ...vals]
    );

    const result = await pool.query('SELECT * FROM "Ticket" WHERE id = $1', [id]);
    res.json({ success: true, ticket: result.rows[0] });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ========== GET: SLA 预警看板 ==========
app.get('/api/itil/sla-alerts', async (req, res) => {
  try {
    const now = new Date();
    const result = await pool.query(`
      SELECT id, title, status, priority, "priorityCalc", "slaDeadline", "slaBreached",
             "createdAt", "itilCategory",
             u.name as "assignedTo"
      FROM "Ticket" t
      LEFT JOIN "User" u ON t."userId" = u.id
      WHERE "isComplete" = false AND "slaDeadline" IS NOT NULL
      ORDER BY "slaDeadline" ASC
    `);

    const breached = result.rows.filter(t => new Date(t.slaDeadline) <= now || t.slaBreached);
    const warning = result.rows.filter(t => {
      const diff = (new Date(t.slaDeadline) - now) / 60000;
      return diff > 0 && diff <= 30 && !t.slaBreached;
    });

    res.json({ success: true, breached, warning, healthy: result.rows.length - breached.length - warning.length });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ========== PUT: ITIL 关闭工单 ==========
app.put('/api/itil/close/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { closureCode, resolution } = req.body;

    await pool.query(`
      UPDATE "Ticket" 
      SET status = 'done', "isComplete" = true, "closureCode" = $2, note = $3
      WHERE id = $1
    `, [id, closureCode, resolution || null]);

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ========== GET: CMDB 配置项列表 ==========
app.get('/api/itil/cis', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT "ciName", COUNT(*) as count, 
             json_agg(json_build_object('id', id, 'title', title, 'status', status))
      FROM "Ticket" 
      WHERE "ciName" IS NOT NULL
      GROUP BY "ciName"
      ORDER BY "ciName"
    `);
    res.json({ success: true, cis: result.rows });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ========== GET: ITIL 仪表盘统计 ==========
app.get('/api/itil/stats', async (req, res) => {
  try {
    const [catResult, slaResult, statusResult] = await Promise.all([
      pool.query(`SELECT "itilCategory", COUNT(*) FROM "Ticket" GROUP BY "itilCategory"`),
      pool.query(`SELECT COUNT(*) FILTER (WHERE "slaBreached" = true) as breached,
                         COUNT(*) FILTER (WHERE "slaBreached" = false AND "slaDeadline" IS NOT NULL AND "slaDeadline" < NOW() + INTERVAL '30 min') as at_risk,
                         COUNT(*) FILTER (WHERE "slaDeadline" IS NOT NULL AND "isComplete" = false) as total_sla
                  FROM "Ticket"`),
      pool.query(`SELECT status, COUNT(*) FROM "Ticket" WHERE "isComplete" = false GROUP BY status`),
    ]);

    res.json({
      success: true,
      byCategory: Object.fromEntries(catResult.rows.map(r => [r.itilCategory, r.count])),
      sla: slaResult.rows[0],
      byStatus: Object.fromEntries(statusResult.rows.map(r => [r.status, r.count])),
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ========== 静态文件（前端面板） ==========
app.use(express.static(__dirname + '/public'));

const PORT = process.env.PORT || 4000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ ITIL 微服务运行在 http://localhost:${PORT}`);
  console.log(`   ITIL 面板: http://localhost:${PORT}/`);
  console.log(`   API:       http://localhost:${PORT}/api/itil/stats`);
});
