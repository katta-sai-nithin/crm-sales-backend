import { userService } from '../services/user.service.js';
import { authService, toPublicUser } from '../services/auth.service.js';
import { sendSuccess, sendCreated, sendNoContent } from '../utils/ApiResponse.js';

/**
 * GET /api/v1/users/me
 */
export const getMyProfile = async (req, res) => {
  const user = await authService.me(req.userId);
  return sendSuccess(res, { message: 'Profile retrieved', data: user });
};

/**
 * GET /api/v1/users  (ADMIN and SALES_MANAGER)
 */
export const listUsers = async (req, res) => {
  const { records, pagination } = await userService.list(req.query, req.user);
  return sendSuccess(res, {
    message: 'Users fetched successfully',
    data: records,
    pagination,
  });
};

/**
 * POST /api/v1/users  (ADMIN)
 */
export const createUser = async (req, res) => {
  const user = await userService.create(req.body, req.user);
  return sendCreated(res, { message: 'User created successfully', data: user });
};

/**
 * GET /api/v1/users/assignable  (ADMIN and SALES_MANAGER)
 */
export const listAssignableUsers = async (req, res) => {
  const users = await userService.listAssignableUsers(req.user);
  return sendSuccess(res, { message: 'Assignable users fetched', data: users });
};

/**
 * GET /api/v1/users/:id
 */
export const getUser = async (req, res) => {
  const user = await userService.getById(req.params.id, req.user);
  return sendSuccess(res, { message: 'User fetched successfully', data: toPublicUser(user) });
};

/**
 * PATCH /api/v1/users/:id  (ADMIN)
 */
export const updateUser = async (req, res) => {
  const user = await userService.update(req.params.id, req.body, req.user);
  return sendSuccess(res, { message: 'User updated successfully', data: user });
};

/**
 * PATCH /api/v1/users/:id/status  (ADMIN)
 */
export const setUserStatus = async (req, res) => {
  const isActive = req.body?.isActive;
  const result = await userService.setActiveStatus(req.params.id, isActive, req.user);
  return sendSuccess(res, {
    message: `User ${isActive ? 'activated' : 'deactivated'} successfully`,
    data: result,
  });
};

/**
 * DELETE /api/v1/users/:id  (ADMIN)
 */
export const deleteUser = async (req, res) => {
  await userService.remove(req.params.id, req.user);
  return sendNoContent(res);
};