/**
 * Team Service
 *
 * CRUD operations for teams within an organization.
 * Teams exist inside orgs: Org > Team > User
 */

import db from "../db/database";

// ── Types ─────────────────────────────────────────────────────────────

export interface Team {
  id: number;
  orgId: number;
  name: string;
  slug: string;
  createdAt: number;
}

export interface TeamMember {
  id: number;
  teamId: number;
  userId: number;
  role: "lead" | "member";
  joinedAt: number;
}

export interface TeamWithMembers extends Team {
  members: Array<{
    id: number;
    userId: number;
    role: string;
    joinedAt: number;
    email?: string;
    name?: string;
  }>;
}

// ── Helpers ───────────────────────────────────────────────────────────

function toTeam(row: Record<string, unknown>): Team {
  return {
    id: row.id as number,
    orgId: row.org_id as number,
    name: row.name as string,
    slug: row.slug as string,
    createdAt: row.created_at as number,
  };
}

function toMember(row: Record<string, unknown>): TeamMember {
  return {
    id: row.id as number,
    teamId: row.team_id as number,
    userId: row.user_id as number,
    role: row.role as "lead" | "member",
    joinedAt: row.joined_at as number,
  };
}

// ── Team CRUD ─────────────────────────────────────────────────────────

export function createTeam(orgId: number, name: string, slug: string): Team {
  const now = Date.now();
  const result = db.prepare(
    "INSERT INTO teams (org_id, name, slug, created_at) VALUES (?, ?, ?, ?)"
  ).run(orgId, name, slug, now);

  return {
    id: Number(result.lastInsertRowid),
    orgId,
    name,
    slug,
    createdAt: now,
  };
}

export function getTeamById(id: number): Team | null {
  const row = db.prepare("SELECT * FROM teams WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? toTeam(row) : null;
}

export function getTeamsByOrg(orgId: number): Team[] {
  const rows = db.prepare(
    "SELECT * FROM teams WHERE org_id = ? ORDER BY created_at ASC"
  ).all(orgId) as Record<string, unknown>[];
  return rows.map(toTeam);
}

export function deleteTeam(id: number): boolean {
  const result = db.prepare("DELETE FROM teams WHERE id = ?").run(id);
  return result.changes > 0;
}

export function updateTeam(id: number, name: string): boolean {
  const result = db.prepare("UPDATE teams SET name = ? WHERE id = ?").run(name, id);
  return result.changes > 0;
}

// ── Membership ────────────────────────────────────────────────────────

export function addTeamMember(
  teamId: number,
  userId: number,
  role: "lead" | "member" = "member"
): TeamMember {
  const now = Date.now();
  const result = db.prepare(
    "INSERT INTO team_members (team_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)"
  ).run(teamId, userId, role, now);

  return {
    id: Number(result.lastInsertRowid),
    teamId,
    userId,
    role,
    joinedAt: now,
  };
}

export function removeTeamMember(teamId: number, userId: number): boolean {
  const result = db.prepare(
    "DELETE FROM team_members WHERE team_id = ? AND user_id = ?"
  ).run(teamId, userId);
  return result.changes > 0;
}

export function getTeamMembers(teamId: number): Array<TeamMember & { email?: string; name?: string }> {
  const rows = db.prepare(`
    SELECT tm.*, u.email, u.name as user_name
    FROM team_members tm
    LEFT JOIN users u ON u.id = tm.user_id
    WHERE tm.team_id = ?
    ORDER BY tm.joined_at ASC
  `).all(teamId) as Record<string, unknown>[];

  return rows.map((row) => ({
    ...toMember(row),
    email: row.email as string | undefined,
    name: row.user_name as string | undefined,
  }));
}

export function getTeamsForUser(userId: number): Team[] {
  const rows = db.prepare(`
    SELECT t.* FROM teams t
    INNER JOIN team_members tm ON tm.team_id = t.id
    WHERE tm.user_id = ?
    ORDER BY t.created_at ASC
  `).all(userId) as Record<string, unknown>[];
  return rows.map(toTeam);
}

export function getTeamWithMembers(teamId: number): TeamWithMembers | null {
  const team = getTeamById(teamId);
  if (!team) return null;

  const members = getTeamMembers(teamId);
  return { ...team, members };
}
