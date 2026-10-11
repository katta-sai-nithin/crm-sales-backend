import mongoose from 'mongoose';
import { User } from '../models/User.js';
import { ROLES } from '../constants/roles.js';
import { isInManagerTeam } from './accessScope.service.js';
import { ApiError } from '../utils/ApiError.js';
import { normalizeEmail, buildSearchRegex } from '../utils/sanitize.js';
import { toObjectId } from '../utils/objectId.js';
import { executePaginatedQuery } from '../utils/query.js';
import { revokeAllUserTokens } from './token.service.js';
import { timelineService } from './timeline.service.js';
import { TIMELINE_ACTIONS, TIMELINE_ENTITY_TYPES } from '../constants/timeline.js';
import { toPublicUser } from './auth.service.js';

class UserService {
  /**
   * List users with search, filters, sorting and pagination.
   *
   * Sales Executives are not allowed to call this endpoint at all (route level),
   * but the service still applies a defensive scope so that a future caller
   * cannot leak the whole user directory.
   */
  async list(query, actor) {
    const filter = {};

    if (query.search) {
      const regex = buildSearchRegex(query.search);
      if (regex) filter.$or = [{ name: regex }, { email: regex }];
    }
    if (query.role) filter.role = query.role;
    if (query.isActive !== undefined) filter.isActive = query.isActive;

    if (query.dateFrom || query.dateTo) {
      const range = {};
      if (query.dateFrom) range.$gte = new Date(query.dateFrom);
      if (query.dateTo) range.$lte = new Date(query.dateTo);
      filter.createdAt = range;
    }

    // Sales Managers can only see non-admin accounts; Admins see everyone.
    if (actor.role === ROLES.SALES_MANAGER) {
      filter.role = { $ne: ROLES.ADMIN };
    }

    const sort = { [query.sortBy || 'createdAt']: query.sortOrder === 'asc' ? 1 : -1, _id: -1 };
    const { page, limit } = query;
    const skip = (page - 1) * limit;

    const result = await executePaginatedQuery(User, { filter, sort, page, limit, skip });

    return {
      records: result.records.map(toPublicUser),
      pagination: result.pagination,
    };
  }

  async getById(id, actor = null) {
    const user = await User.findById(toObjectId(id));
    if (!user) throw ApiError.notFound('User not found');

    // Sales Managers must not be able to read or manage administrator accounts.
    // A 404 (not a 403) avoids confirming that an ADMIN account exists.
    if (actor && actor.role === ROLES.SALES_MANAGER && user.role === ROLES.ADMIN) {
      throw ApiError.notFound('User not found');
    }

    return user;
  }

  /**
   * Create a user. Only reachable by an authenticated ADMIN.
   */
  async create(payload, actor) {
    this.assertAdmin(actor);

    const email = normalizeEmail(payload.email);
    const existing = await User.findOne({ email });
    if (existing) {
      throw ApiError.conflict('An account with this email address already exists', {
        errors: [{ field: 'email', message: 'Email already registered' }],
      });
    }

    if (payload.team) {
      const { Team } = await import('../models/User.js');
      const teamExists = await Team.exists({ _id: toObjectId(payload.team) });
      if (!teamExists) throw ApiError.badRequest('The referenced team does not exist');
    }

    const passwordHash = await User.hashPassword(payload.password);
    const user = await User.create({
      name: payload.name,
      email,
      phone: payload.phone ?? '',
      passwordHash,
      role: payload.role,
      isActive: true,
      team: payload.team ? toObjectId(payload.team) : null,
    });

    await timelineService.record({
      action: TIMELINE_ACTIONS.USER_CREATED,
      entityType: TIMELINE_ENTITY_TYPES.USER,
      entityId: user._id,
      entityLabel: user.name,
      performedBy: actor._id,
      newValue: user,
      metadata: { role: user.role, email: user.email },
    });

    return toPublicUser(user);
  }

  /**
   * Update a user's profile fields.
   *
   * Role changes are privileged: only an ADMIN may change a role, and an
   * administrator can never demote the last remaining active administrator.
   */
  async update(id, payload, actor) {
    this.assertAdmin(actor);

    const user = await User.findById(toObjectId(id));
    if (!user) throw ApiError.notFound('User not found');

    const before = user.toObject();

    if (payload.email) {
      const email = normalizeEmail(payload.email);
      if (email !== user.email) {
        const duplicate = await User.findOne({ email, _id: { $ne: user._id } });
        if (duplicate) {
          throw ApiError.conflict('An account with this email address already exists', {
            errors: [{ field: 'email', message: 'Email already registered' }],
          });
        }
        user.email = email;
      }
    }

    if (payload.name !== undefined) user.name = payload.name;
    if (payload.phone !== undefined) user.phone = payload.phone;
    if (payload.team !== undefined) user.team = payload.team ? toObjectId(payload.team) : null;

    if (payload.role && payload.role !== user.role) {
      await this.assertRoleChangeAllowed(user, payload.role);
      user.role = payload.role;
      // An ADMIN account is never scoped to a team.
      if (payload.role === ROLES.ADMIN) user.team = null;
    }

    await user.save();

    await timelineService.recordChanges({
      action:
        payload.role && payload.role !== before.role
          ? TIMELINE_ACTIONS.USER_ROLE_CHANGED
          : TIMELINE_ACTIONS.USER_UPDATED,
      entityType: TIMELINE_ENTITY_TYPES.USER,
      entityId: user._id,
      entityLabel: user.name,
      performedBy: actor._id,
      before,
      after: user.toObject(),
      metadata: {},
    });

    return toPublicUser(user);
  }

  /**
   * Activate or deactivate an account.
   *
   * Deactivation blocks future authentication immediately (the authenticate
   * middleware re-reads the user on every request) and revokes all outstanding
   * refresh sessions.
   *
   * Business rule: ownership of existing leads / customers / deals is *not*
   * transferred automatically. The API reports how many records would become
   * orphaned so that an administrator can reassign them explicitly.
   */
  async setActiveStatus(id, isActive, actor) {
    this.assertAdmin(actor);

    const user = await User.findById(toObjectId(id));
    if (!user) throw ApiError.notFound('User not found');

    if (user.isActive === isActive) {
      throw ApiError.unprocessable(
        `User is already ${isActive ? 'active' : 'inactive'}`
      );
    }

    if (!isActive && user.role === ROLES.ADMIN) {
      await this.assertNotLastAdmin(user._id);
    }

    user.isActive = isActive;
    await user.save();

    if (!isActive) {
      await revokeAllUserTokens(user._id, 'account_deactivated');
    }

    const orphanedCounts = isActive ? null : await this.countAssignedRecords(user._id);

    await timelineService.record({
      action: isActive ? TIMELINE_ACTIONS.USER_ACTIVATED : TIMELINE_ACTIONS.USER_DEACTIVATED,
      entityType: TIMELINE_ENTITY_TYPES.USER,
      entityId: user._id,
      entityLabel: user.name,
      performedBy: actor._id,
      previousValue: { isActive: !isActive },
      newValue: { isActive },
      metadata: {
        email: user.email,
        role: user.role,
        ...(orphanedCounts ? { orphanedRecords: orphanedCounts } : {}),
      },
    });

    return { user: toPublicUser(user), orphanedRecords: orphanedCounts };
  }

  /**
   * Delete a user.
   *
   * Only administrators may delete accounts, and an account that still owns
   * leads, customers or deals is never deleted - those records would be silently
   * orphaned. The caller must reassign or deactivate the user first.
   */
  async remove(id, actor) {
    this.assertAdmin(actor);

    const user = await User.findById(toObjectId(id));
    if (!user) throw ApiError.notFound('User not found');

    if (String(user._id) === String(actor._id)) {
      throw ApiError.unprocessable('You cannot delete your own account');
    }
    if (user.role === ROLES.ADMIN) {
      await this.assertNotLastAdmin(user._id);
    }

    const assigned = await this.countAssignedRecords(user._id);
    const totalAssigned = assigned.leads + assigned.customers + assigned.deals + assigned.activities;
    if (totalAssigned > 0) {
      throw ApiError.unprocessable(
        'This user still owns CRM records. Reassign them (or deactivate the account) before deleting.',
        { details: assigned }
      );
    }

    await revokeAllUserTokens(user._id, 'account_deleted');
    await user.deleteOne();

    await timelineService.record({
      action: TIMELINE_ACTIONS.USER_UPDATED,
      entityType: TIMELINE_ENTITY_TYPES.USER,
      entityId: user._id,
      entityLabel: user.name,
      performedBy: actor._id,
      previousValue: { name: user.name, email: user.email, role: user.role, isActive: user.isActive },
      metadata: { deleted: true },
    });

    return { id: String(user._id) };
  }

  /**
   * Users eligible to receive a lead / customer / deal assignment.
   */
  async listAssignableUsers(actor, { role } = {}) {
    const filter = { isActive: true };
    const assignableRoles = role ? [role] : [ROLES.SALES_MANAGER, ROLES.SALES_EXECUTIVE];
    filter.role = { $in: assignableRoles };

    if (actor.role === ROLES.SALES_MANAGER) {
      filter._id = { $in: await this.getTeamScopeIds(actor) };
    }

    return User.find(filter).select('name email role isActive team').sort({ name: 1 }).lean();
  }

  /**
   * Resolve the ids a manager may act on: themselves + their team members.
   */
  async getTeamScopeIds(manager) {
    const ids = [String(manager._id)];
    const teamId = manager.team;
    if (teamId) {
      const { Team } = await import('../models/User.js');
      const team = await Team.findById(teamId).select('members').lean();
      for (const memberId of team?.members || []) ids.push(String(memberId));
    }
    // Also include executives that name this manager through their team doc even
    // if the manager object was loaded without the populated team.
    const teamDocs = await mongoose.model('Team').find({ members: toObjectId(manager._id) }).select('members').lean();
    for (const team of teamDocs) {
      for (const memberId of team.members || []) ids.push(String(memberId));
    }
    return [...new Set(ids)];
  }

  async countAssignedRecords(userId) {
    const objectId = toObjectId(userId);
    const [leads, customers, deals, activities] = await Promise.all([
      mongoose.model('Lead').countDocuments({ assignedTo: objectId }),
      mongoose.model('Customer').countDocuments({ assignedTo: objectId }),
      mongoose.model('Deal').countDocuments({ assignedTo: objectId }),
      mongoose.model('Activity').countDocuments({ assignedTo: objectId }),
    ]);
    return { leads, customers, deals, activities };
  }

  async assertNotLastAdmin(excludeUserId) {
    const activeAdmins = await User.countDocuments({
      role: ROLES.ADMIN,
      isActive: true,
      _id: { $ne: toObjectId(excludeUserId) },
    });
    if (activeAdmins === 0) {
      throw ApiError.unprocessable('At least one active administrator must remain in the system');
    }
  }

  async assertRoleChangeAllowed(user, nextRole) {
    if (user.role === ROLES.ADMIN && nextRole !== ROLES.ADMIN) {
      await this.assertNotLastAdmin(user._id);
    }
  }

  /**
   * Validate an assignment target for a lead / customer / deal / activity.
   *
   * Rules (enforced server side, never trusted from the payload):
   *  - the target must exist, be active and hold a sales role;
   *  - ADMIN may assign to any active sales user;
   *  - SALES_MANAGER may assign to themselves or to a member of their team;
   *  - SALES_EXECUTIVE may assign to themselves only.
   */
  async assertAssignable(targetId, actor, { currentAssignee = null } = {}) {
    const targetObjectId = toObjectId(targetId);
    if (!targetObjectId) {
      throw ApiError.badRequest('assignedTo must be a valid MongoDB ObjectId');
    }

    const target = await User.findById(targetObjectId);
    if (!target) throw ApiError.badRequest('The user you are trying to assign to does not exist');
    if (!target.isActive) {
      throw ApiError.unprocessable('Records can only be assigned to active users');
    }
    if (target.role === ROLES.ADMIN) {
      throw ApiError.unprocessable('Records cannot be assigned to an administrator');
    }
    if (![ROLES.SALES_MANAGER, ROLES.SALES_EXECUTIVE].includes(target.role)) {
      throw ApiError.unprocessable('Records can only be assigned to sales users');
    }

    if (actor.role === ROLES.ADMIN) return target;

    if (actor.role === ROLES.SALES_EXECUTIVE) {
      if (String(target._id) !== String(actor._id)) {
        throw ApiError.forbidden('Sales Executives may only assign records to themselves');
      }
      return target;
    }

    // Sales Manager
    const teamIds = await this.getTeamScopeIds(actor);
    const isSelf = String(target._id) === String(actor._id);
    const isTeamMember = teamIds.map(String).includes(String(target._id));
    if (!isSelf && !isTeamMember) {
      throw ApiError.forbidden('Sales Managers may only assign records within their own team');
    }
    if (currentAssignee && !isInManagerTeam(actor._id, teamIds, currentAssignee)) {
      throw ApiError.forbidden('You may only reassign records inside your own book of business');
    }

    return target;
  }

  assertAdmin(actor) {
    if (!actor || actor.role !== ROLES.ADMIN) {
      throw ApiError.forbidden('Administrator privileges are required for this operation');
    }
  }
}

export const userService = new UserService();
export default userService;