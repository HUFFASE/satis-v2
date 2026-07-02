import prisma from "./prisma";

interface AuditLogPayload {
  userId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  oldValue?: any;
  newValue?: any;
}

/**
 * Idempotently writes audit logs to the AuditLog table using Prisma's JSON field support.
 */
export async function writeAuditLog({
  userId,
  action,
  entityType,
  entityId,
  oldValue,
  newValue,
}: AuditLogPayload) {
  return prisma.auditLog.create({
    data: {
      userId: userId || null,
      action,
      entityType,
      entityId,
      oldValue: oldValue ? JSON.parse(JSON.stringify(oldValue)) : null,
      newValue: newValue ? JSON.parse(JSON.stringify(newValue)) : null,
    },
  });
}
