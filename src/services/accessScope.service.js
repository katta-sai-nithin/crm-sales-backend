import { ROLES } from '../constants/roles.js';
import { toObjectId } from '../utils/objectId.js';

/**
 * Record-level visibility rules ("scope").
 *
 *  - ADMIN            : everything.
 *  - SALES_MANAGER    : records assigned to the manager themselves OR to any
 *                       member of the manager's team.
 *  - SALES_EXECUTIVE  : only records assigned to the executive themselves.
 *
 * Leads additionally expose `createdBy` scoping so a manager can see records
 * their team captured but has not yet distributed.
 */
export const ScopeType = Object.freeze({
  LEAD: 'LEAD',
  CUSTOMER: 'CUSTOMER',
  DEAL: 'DEAL',
  ACTIVITY: 'ACTIVITY',
  USER: 'USER',
});

/**
 * Load the team membership for a manager, memoised on the request.
 */
async function loadTeamMemberIds(user) {
  if (!user.team) return [];
  if (!user.team.members) {
    const Team = (await import('../models/User.js')).Team;
    const team = await Team.findById(user.team).select('members').lean();
    return (team?.members || []).map((memberId) => memberId.toString());
  }
  return (user.team.members || []).map((memberId) => String(memberId));
}

/**
 * Build the visibility filter for a user.
 */
export async function buildScopeFilter(user, scopeType, { teamMemberIds } = {}) {
  const id = user.id ?? user._id?.toString();
  if (!id) return { _id: null };

  // Aggregation pipelines are NOT cast by Mongoose, so the scope is built with
  // real ObjectIds here. This keeps list queries and analytics queries identical.
  const userObjectId = toObjectId(id);
  if (!userObjectId) return { _id: null };

  if (user.role === ROLES.ADMIN) return {};

  if (user.role === ROLES.SALES_MANAGER) {
    const members = teamMemberIds ?? (await loadTeamMemberIds(user));
    const allowedIds = [userObjectId, ...members.map((memberId) => toObjectId(memberId)).filter(Boolean)];
    if (scopeType === ScopeType.LEAD) {
      return {
        $or: [
          { assignedTo: { $in: allowedIds } },
          { createdBy: { $in: allowedIds } },
          // Unassigned leads form a shared pool that a manager may claim.
          { assignedTo: null },
        ],
      };
    }
    return { assignedTo: { $in: allowedIds } };
  }

  // Sales Executive: only their own records. Unassigned leads form a shared pool
  // that an executive is allowed to *claim* (by assigning it to themselves).
  if (scopeType === ScopeType.LEAD) {
    return { $or: [{ assignedTo: userObjectId }, { assignedTo: null }] };
  }

  return { assignedTo: userObjectId };
}

/**
 * Build the list of ids a user is allowed to see (used for `$in` filters such as
 * "activities related to a visible deal").
 */
export async function buildVisibleIdSet(user) {
  const id = user.id ?? user._id?.toString();
  if (user.role === ROLES.ADMIN) return null; // null == unrestricted
  if (user.role === ROLES.SALES_MANAGER) {
    const members = await loadTeamMemberIds(user);
    return [id, ...members];
  }
  return [id];
}

/**
 * Check whether a concrete record is visible to the user.
 */
export async function isRecordVisible(user, scopeType, record, options = {}) {
  if (!record) return false;
  const filter = await buildScopeFilter(user, scopeType, options);
  if (!Object.keys(filter).length) return true;

  const assignees = [];
  const assignTo = record.assignedTo;
  if (assignTo) {
    if (Array.isArray(assignTo)) assignees.push(...assignTo.map((a) => String(a)));
    else if (typeof assignTo === 'object' && assignTo._id) assignees.push(String(assignTo._id));
    else assignees.push(String(assignTo));
  }
  const creators = [];
  const createdBy = record.createdBy;
  if (createdBy) {
    if (typeof createdBy === 'object' && createdBy._id) creators.push(String(createdBy._id));
    else creators.push(String(createdBy));
  }

  const allowed = [];
  if (filter.assignedTo?.$in) allowed.push(...filter.assignedTo.$in.map(String));
  if (filter.$or) {
    for (const clause of filter.$or) {
      if (clause.assignedTo?.$in) allowed.push(...clause.assignedTo.$in.map(String));
      if (clause.createdBy?.$in) allowed.push(...clause.createdBy.$in.map(String));
    }
  }
  if (!allowed.length) return false;

  const candidates = scopeType === ScopeType.LEAD ? [...assignees, ...creators] : assignees;
  return candidates.some((candidate) => allowed.includes(candidate));
}

/**
 * Can the user act on records of another user? Used by write operations.
 */
export function hasGlobalWriteAccess(user) {
  return user.role === ROLES.ADMIN || user.role === ROLES.SALES_MANAGER;
}

/**
 * Check that a target user id belongs to the manager's team (or is the manager).
 */
export function isInManagerTeam(managerId, memberIds, targetId) {
  if (!targetId) return false;
  const target = String(targetId);
  if (target === String(managerId)) return true;
  return (memberIds || []).map(String).includes(target);
}