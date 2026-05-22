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

// ========== POST: AI 自动分类工单 (DeepSeek) ==========
app.post('/api/itil/ai-classify', async (req, res) => {
  try {
    const { ticketId } = req.body;
    if (!ticketId) return res.status(400).json({ success: false, error: 'ticketId required' });

    const result = await pool.query(
      `SELECT id, title, detail, email, name, "itilCategory"
       FROM "Ticket" WHERE id = $1`,
      [ticketId]
    );
    const ticket = result.rows[0];
    if (!ticket) return res.status(404).json({ success: false, error: 'Ticket not found' });

    // 提取纯文本描述（detail 是 JSON 格式的富文本）
    let desc = '';
    try {
      const parsed = JSON.parse(ticket.detail || '{}');
      if (typeof parsed === 'string') {
        desc = parsed;
      } else if (parsed.text) {
        desc = parsed.text;
      } else if (Array.isArray(parsed.content)) {
        desc = parsed.content.map(b => b.content?.map(c => c.text || '').join(' ')).join(' ');
      } else {
        desc = JSON.stringify(parsed);
      }
    } catch { desc = ticket.detail || ''; }
    desc = desc.replace(/<[^>]*>/g, '').trim().slice(0, 1500);

    const prompt = `你是一个 ITIL 工程师。分析这个 IT 工单，返回 JSON 格式的分类。

工单标题: ${ticket.title || '(空)'}
工单描述: ${desc || '(空)'}
提交人: ${ticket.name || ticket.email || '未知'}

分析：
1. itilCategory: INCIDENT(事故) | SERVICE_REQUEST(服务请求) | PROBLEM(问题) | CHANGE(变更) | ACCESS_REQUEST(权限请求)
2. impact: 影响度 1-5（1=单用户, 3=部门, 5=全公司）
3. urgency: 紧急度 1-5（1=不紧急, 3=影响工作, 5=业务中断）
4. reason: 简短判断理由（中文，一句话）

只返回 JSON：{"itilCategory":"...","impact":1-5,"urgency":1-5,"reason":"..."}`;

    let classification;
    const apiKey = process.env.DEEPSEEK_API_KEY;

    if (apiKey && apiKey !== 'sk-your-key-here') {
      const aiRes = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.1,
          response_format: { type: 'json_object' },
        }),
      });

      if (!aiRes.ok) {
        const err = await aiRes.text();
        return res.status(502).json({ success: false, error: `DeepSeek API error: ${aiRes.status}`, detail: err });
      }

      const data = await aiRes.json();
      classification = JSON.parse(data.choices[0].message.content);
    } else {
      // 无 API Key 时用简单规则兜底
      const text = (ticket.title + ' ' + desc).toLowerCase();
      let cat = 'SERVICE_REQUEST', imp = 2, urg = 2, reason = '未配置 API Key，使用默认分类';
      if (/故障|报错|崩溃|宕机|打不开|不能|无法|error|crash|down/i.test(text)) { cat = 'INCIDENT'; imp = 3; urg = 3; reason = '标题含故障关键词'; }
      if (/申请|权限|开通|账号|密码|access/i.test(text)) { cat = 'ACCESS_REQUEST'; imp = 1; urg = 1; reason = '标题含权限/申请关键词'; }
      classification = { itilCategory: cat, impact: imp, urgency: urg, reason };
    }

    // 计算优先级
    const imp = Math.max(1, Math.min(5, classification.impact || 2));
    const urg = Math.max(1, Math.min(5, classification.urgency || 2));
    const slaHours = [4, 8, 24, 48, 120];
    const priorities = [1, 1, 2, 2, 3, 2, 2, 3, 3, 4, 2, 3, 3, 4, 4, 3, 3, 4, 4, 5, 3, 3, 4, 4, 5];
    const idx = (imp - 1) * 5 + (urg - 1);
    const prioCalc = priorities[Math.min(idx, 24)];

    await pool.query(
      `UPDATE "Ticket" SET
        "itilCategory" = $2, impact = $3, urgency = $4, "priorityCalc" = $5,
        "slaDeadline" = NOW() + ($6 * interval '1 hour'), "firstResponse" = COALESCE("firstResponse", NOW())
       WHERE id = $1`,
      [ticketId, classification.itilCategory, imp, urg, prioCalc, slaHours[prioCalc - 1]]
    );

    res.json({
      success: true,
      ticketId,
      classification: {
        itilCategory: classification.itilCategory,
        impact: imp,
        urgency: urg,
        priorityCalc: prioCalc,
        slaHours: slaHours[prioCalc - 1],
        reason: classification.reason,
      },
    });
  } catch (e) {
    console.error('AI classify error:', e);
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
