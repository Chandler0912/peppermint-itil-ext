import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../prisma";
import { checkSession } from "../lib/session";
import { requirePermission } from "../lib/roles";

// ============================================================
// ITIL 优先级矩阵 (影响度 × 紧急度 → 优先级 P1-P5)
// 参考 ITIL 2011 标准
// ============================================================
// 影响度\紧急度 | 5(最高) | 4 | 3 | 2 | 1(最低)
//         5     |   P1    | P1 | P2 | P2 | P3
//         4     |   P1    | P2 | P2 | P3 | P3
//         3     |   P2    | P2 | P3 | P3 | P4
//         2     |   P2    | P3 | P3 | P4 | P4
//         1     |   P3    | P3 | P4 | P4 | P5
// ============================================================

const PRIORITY_MATRIX: Record<number, Record<number, number>> = {
  5: { 5: 1, 4: 1, 3: 2, 2: 2, 1: 3 },
  4: { 5: 1, 4: 2, 3: 2, 2: 3, 1: 3 },
  3: { 5: 2, 4: 2, 3: 3, 2: 3, 1: 4 },
  2: { 5: 2, 4: 3, 3: 3, 2: 4, 1: 4 },
  1: { 5: 3, 4: 3, 3: 4, 2: 4, 1: 5 },
};

// SLA 目标时间（分钟），按优先级配置
const SLA_TARGETS: Record<number, { response: number; resolve: number }> = {
  1: { response: 15, resolve: 240 },    // P1: 15min 响应, 4h 解决
  2: { response: 30, resolve: 480 },    // P2: 30min 响应, 8h 解决
  3: { response: 120, resolve: 1440 },  // P3: 2h 响应, 24h 解决
  4: { response: 240, resolve: 2880 },  // P4: 4h 响应, 48h 解决
  5: { response: 480, resolve: 7200 },  // P5: 8h 响应, 5个工作日
};

/**
 * 根据影响度和紧急度计算 ITIL 优先级
 */
function calculatePriority(impact: number, urgency: number): number {
  const clampedImpact = Math.max(1, Math.min(5, impact));
  const clampedUrgency = Math.max(1, Math.min(5, urgency));
  return PRIORITY_MATRIX[clampedImpact][clampedUrgency];
}

/**
 * 计算 SLA 截止时间
 */
function calculateSLADeadline(priority: number, type: 'response' | 'resolve'): Date {
  const now = new Date();
  const targetMinutes = SLA_TARGETS[priority]?.[type] ?? 1440;
  return new Date(now.getTime() + targetMinutes * 60 * 1000);
}

/**
 * 根据 ITIL 类别生成默认的影响度/紧急度
 */
function defaultImpactUrgency(category: string): { impact: number; urgency: number } {
  switch (category) {
    case 'INCIDENT':    return { impact: 4, urgency: 3 }; // 事故默认较高
    case 'PROBLEM':     return { impact: 3, urgency: 2 }; // 问题中等
    case 'CHANGE':      return { impact: 2, urgency: 2 }; // 变更中等偏低
    case 'ACCESS_REQUEST': return { impact: 1, urgency: 1 }; // 权限请求低
    case 'SERVICE_REQUEST':
    default:            return { impact: 2, urgency: 2 };
  }
}

/**
 * 优先级显示文本
 */
function priorityLabel(priority: number): string {
  const labels: Record<number, string> = {
    1: 'P1 - 紧急',
    2: 'P2 - 高',
    3: 'P3 - 中',
    4: 'P4 - 低',
    5: 'P5 - 计划',
  };
  return labels[priority] || `P${priority}`;
}

// ============================================================
// Routes
// ============================================================

export function itilRoutes(fastify: FastifyInstance) {
  // ============== ITIL: 批量更新影响度/紧急度（自动计算优先级） ==============
  fastify.put(
    "/api/v1/itil/prioritize",
    {
      preHandler: requirePermission(["issue::update"]),
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id, impact, urgency }: any = request.body;

      if (!impact || !urgency) {
        return reply.status(400).send({ success: false, message: "impact and urgency are required" });
      }

      const priority = calculatePriority(Number(impact), Number(urgency));
      const slaDeadline = calculateSLADeadline(priority, 'resolve');

      const ticket = await prisma.ticket.update({
        where: { id },
        data: {
          impact: Number(impact),
          urgency: Number(urgency),
          priorityCalc: priority,
          priority: priorityLabel(priority),
          slaDeadline,
        },
      });

      reply.send({ success: true, ticket, priority });
    }
  );

  // ============== ITIL: 设置 ITIL 类别 ==============
  fastify.put(
    "/api/v1/itil/category",
    {
      preHandler: requirePermission(["issue::update"]),
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id, itilCategory }: any = request.body;

      const defaults = defaultImpactUrgency(itilCategory);
      const priority = calculatePriority(defaults.impact, defaults.urgency);
      const slaDeadline = calculateSLADeadline(priority, 'resolve');

      const ticket = await prisma.ticket.update({
        where: { id },
        data: {
          itilCategory,
          impact: defaults.impact,
          urgency: defaults.urgency,
          priorityCalc: priority,
          priority: priorityLabel(priority),
          slaDeadline,
        },
      });

      reply.send({ success: true, ticket });
    }
  );

  // ============== ITIL: 关闭工单（含关闭代码） ==============
  fastify.put(
    "/api/v1/itil/close",
    {
      preHandler: requirePermission(["issue::update"]),
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id, closureCode, resolution }: any = request.body;

      const ticket = await prisma.ticket.update({
        where: { id },
        data: {
          status: "done",
          isComplete: true,
          closureCode,
          note: resolution || undefined,
        },
      });

      reply.send({ success: true, ticket });
    }
  );

  // ============== ITIL: 检查 SLA 状态 ==============
  fastify.get(
    "/api/v1/itil/sla/:id",
    {
      preHandler: requirePermission(["issue::read"]),
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id }: any = request.params;

      const ticket = await prisma.ticket.findUnique({
        where: { id },
        select: {
          id: true,
          priorityCalc: true,
          slaDeadline: true,
          slaBreached: true,
          firstResponse: true,
          status: true,
          createdAt: true,
        },
      });

      if (!ticket) {
        return reply.status(404).send({ success: false, message: "Ticket not found" });
      }

      const now = new Date();
      let slaStatus: 'ok' | 'warning' | 'breached' = 'ok';
      let remainingMinutes: number | null = null;

      if (ticket.slaDeadline) {
        const diff = ticket.slaDeadline.getTime() - now.getTime();
        remainingMinutes = Math.round(diff / 60000);

        if (ticket.slaBreached) {
          slaStatus = 'breached';
        } else if (remainingMinutes < 30 && remainingMinutes > 0) {
          slaStatus = 'warning'; // 30分钟内到期预警
        }
      }

      reply.send({
        success: true,
        sla: {
          ...ticket,
          slaStatus,
          remainingMinutes,
        },
      });
    }
  );

  // ============== ITIL: 所有待办 SLA 预警工单 ==============
  fastify.get(
    "/api/v1/itil/sla-alerts",
    {
      preHandler: requirePermission(["issue::read"]),
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const now = new Date();
      const warningTime = new Date(now.getTime() + 30 * 60 * 1000); // 30分钟后

      const atRiskTickets = await prisma.ticket.findMany({
        where: {
          isComplete: false,
          slaDeadline: { not: null },
          slaBreached: false,
          status: { not: "done" },
        },
        orderBy: { slaDeadline: "asc" },
        include: {
          assignedTo: { select: { id: true, name: true } },
          client: { select: { id: true, name: true } },
        },
      });

      const breached = atRiskTickets.filter(t => t.slaDeadline! < now);
      const warning = atRiskTickets.filter(t => 
        t.slaDeadline! >= now && t.slaDeadline! <= warningTime
      );
      const ok = atRiskTickets.filter(t => t.slaDeadline! > warningTime);

      reply.send({
        success: true,
        summary: {
          total: atRiskTickets.length,
          breached: breached.length,
          warning: warning.length,
          ok: ok.length,
        },
        breached,
        warning,
        ok,
      });
    }
  );

  // ============== ITIL: 配置项查询（CMDB 简化版） ==============
  fastify.get(
    "/api/v1/itil/cis",
    {
      preHandler: requirePermission(["issue::read"]),
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      // 查询所有有关联配置项的工单
      const tickets = await prisma.ticket.findMany({
        where: {
          ciName: { not: null },
        },
        select: {
          ciName: true,
          id: true,
          title: true,
          status: true,
          itilCategory: true,
        },
        orderBy: { ciName: "asc" },
      });

      // 按 CI 名称分组
      const grouped: Record<string, any[]> = {};
      for (const t of tickets) {
        const ci = t.ciName!;
        if (!grouped[ci]) grouped[ci] = [];
        grouped[ci].push(t);
      }

      reply.send({ success: true, cis: grouped, total: tickets.length });
    }
  );
}
