import { db } from "../db/index";
import sqliteDatabase from "../db/database";
import { models } from "../db/schema";
import { Model } from "../types";
import { eq, and, asc } from "drizzle-orm";

function toModel(row: any): Model {
  return {
    id: row.id,
    providerId: row.providerId,
    modelName: row.modelName,
    displayName: row.displayName ?? row.modelName,
    inputCostPer1k: row.inputCostPer1k,
    outputCostPer1k: row.outputCostPer1k,
    maxContextTokens: row.maxContextTokens,
    enabled: row.enabled === 1,
  };
}

export function addModel(
  providerId: number,
  modelName: string,
  opts?: {
    displayName?: string;
    inputCostPer1k?: number;
    outputCostPer1k?: number;
    maxContextTokens?: number;
  },
): Model {
  const result = db
    .insert(models)
    .values({
      providerId,
      modelName,
      displayName: opts?.displayName ?? modelName,
      inputCostPer1k: opts?.inputCostPer1k ?? 0,
      outputCostPer1k: opts?.outputCostPer1k ?? 0,
      maxContextTokens: opts?.maxContextTokens ?? 0,
      enabled: 1,
    })
    .run();

  return getModelById(Number(result.lastInsertRowid))!;
}

export function listModels(providerId?: number): Model[] {
  if (providerId !== undefined) {
    const rows = db
      .select()
      .from(models)
      .where(eq(models.providerId, providerId))
      .orderBy(asc(models.modelName))
      .all();
    return rows.map(toModel);
  }

  const rows = db
    .select()
    .from(models)
    .orderBy(asc(models.providerId), asc(models.modelName))
    .all();
  return rows.map(toModel);
}

export function getModelById(id: number): Model | null {
  const row = db.select().from(models).where(eq(models.id, id)).get();
  return row ? toModel(row) : null;
}

export function findModelByName(modelName: string): Model | null {
  const row = db
    .select()
    .from(models)
    .where(and(eq(models.modelName, modelName), eq(models.enabled, 1)))
    .get();
  return row ? toModel(row) : null;
}

export function updateModel(
  id: number,
  updates: {
    displayName?: string;
    inputCostPer1k?: number;
    outputCostPer1k?: number;
    maxContextTokens?: number;
    enabled?: boolean;
  },
): Model | null {
  const model = getModelById(id);
  if (!model) return null;

  const setObj: Record<string, any> = {};

  if (updates.displayName !== undefined)
    setObj.displayName = updates.displayName;
  if (updates.inputCostPer1k !== undefined)
    setObj.inputCostPer1k = updates.inputCostPer1k;
  if (updates.outputCostPer1k !== undefined)
    setObj.outputCostPer1k = updates.outputCostPer1k;
  if (updates.maxContextTokens !== undefined)
    setObj.maxContextTokens = updates.maxContextTokens;
  if (updates.enabled !== undefined) setObj.enabled = updates.enabled ? 1 : 0;

  if (Object.keys(setObj).length === 0) return model;

  db.update(models).set(setObj).where(eq(models.id, id)).run();

  return getModelById(id);
}

export function deleteModel(id: number): boolean {
  const model = getModelById(id);
  if (!model) return false;

  const result = db.delete(models).where(eq(models.id, id)).run();

  if (result.changes > 0) {
    // Cascade to user_models. We need to find the provider's slug and orgId first.
    // We can do this with a single subquery-based delete.
    sqliteDatabase
      .prepare(
        `DELETE FROM user_models
        WHERE model_slug = ?
          AND provider_slug = (SELECT slug FROM providers WHERE id = ?)
          AND user_id IN (
            SELECT id FROM users 
            WHERE org_id = (SELECT org_id FROM providers WHERE id = ?)
          )`,
      )
      .run(model.modelName, model.providerId, model.providerId);
  }

  return result.changes > 0;
}
