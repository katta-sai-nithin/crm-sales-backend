import swaggerJsdoc from 'swagger-jsdoc';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import config from './env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * OpenAPI definition.
 *
 * Paths are generated from the JSDoc `@openapi` blocks that live next to the real
 * route definitions in src/routes/*.js, so the documentation can never drift into
 * describing an endpoint that does not exist.
 */
const definition = {
  openapi: '3.0.3',
  info: {
    title: 'CRM Sales Management API',
    version: config.appVersion,
    description: `
REST API for a CRM Sales Management System covering the full sales lifecycle:

**Lead generation → qualification → customer conversion → deal management → deal closure.**

### Authentication
All endpoints except \`GET /api/v1/health\`, \`POST /api/v1/auth/register\` and
\`POST /api/v1/auth/login\` require a bearer access token:

\`\`\`
Authorization: Bearer <accessToken>
\`\`\`

Log in with \`POST /api/v1/auth/login\` to obtain an access token and a refresh token.
Send the refresh token in the body or rely on the HttpOnly cookie that is set
automatically. Access tokens are short lived (default 15m) and stateless;
refresh tokens are single use and rotate on every \`POST /api/v1/auth/refresh\`.

### Roles
| Role | Scope |
| --- | --- |
| \`ADMIN\` | System-wide access, full user management |
| \`SALES_MANAGER\` | Their own book of business plus their team |
| \`SALES_EXECUTIVE\` | Only the records assigned to them |

### Conventions
* Every list endpoint accepts \`page\`, \`limit\` (max 100), \`sortBy\`, \`sortOrder\`,
  \`search\`, \`dateFrom\`, \`dateTo\` plus module specific filters.
* Responses use the envelope \`{ success, message, data, pagination }\`.
* Errors use \`{ success: false, message, errors: [] }\`.
* Monetary amounts are expressed in a single currency (see \`currency\` in the
  response) and rounded to 2 decimals.
* \`expectedRevenue\` is always computed server side as
  \`dealValue × probability / 100\`.
`,
    contact: {
      name: 'CRM Sales Backend',
    },
    license: { name: 'MIT' },
  },
  servers: [
    { url: 'http://localhost:5000/api/v1', description: 'Local development' },
    { url: '/api/v1', description: 'Current host' },
  ],
  tags: [
    { name: 'Authentication', description: 'Registration, login, refresh, logout, profile' },
    { name: 'Users', description: 'User administration (ADMIN / SALES_MANAGER)' },
    { name: 'Leads', description: 'Lead capture, qualification, assignment and conversion' },
    { name: 'Customers', description: 'Customer records and their deals/activities' },
    { name: 'Deals', description: 'Pipeline management, stages and financials' },
    { name: 'Activities', description: 'Calls, meetings, follow-ups and reminders' },
    { name: 'Timeline', description: 'Append-only audit history' },
    { name: 'Analytics', description: 'Dashboard, pipeline and team performance' },
    { name: 'System', description: 'Health checks' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Paste the `accessToken` returned by login / refresh.',
      },
    },
    parameters: {
      PageParam: {
        in: 'query',
        name: 'page',
        schema: { type: 'integer', minimum: 1, default: 1 },
        description: 'Page number (1 based).',
      },
      LimitParam: {
        in: 'query',
        name: 'limit',
        schema: { type: 'integer', minimum: 1, maximum: 100, default: 10 },
        description: 'Page size. Maximum 100.',
      },
      SearchParam: {
        in: 'query',
        name: 'search',
        schema: { type: 'string', maxLength: 120 },
        description: 'Free text search (matched literally, never as a regex).',
      },
      SortByParam: {
        in: 'query',
        name: 'sortBy',
        schema: { type: 'string' },
        description: 'Sort field. Only allow-listed values are accepted.',
      },
      SortOrderParam: {
        in: 'query',
        name: 'sortOrder',
        schema: { type: 'string', enum: ['asc', 'desc'], default: 'desc' },
      },
      DateFromParam: {
        in: 'query',
        name: 'dateFrom',
        schema: { type: 'string', format: 'date-time' },
        description: 'Inclusive lower bound of the creation date range.',
      },
      DateToParam: {
        in: 'query',
        name: 'dateTo',
        schema: { type: 'string', format: 'date-time' },
        description: 'Inclusive upper bound of the creation date range.',
      },
    },
    schemas: {
      SuccessResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          message: { type: 'string', example: 'Records fetched successfully' },
          data: { description: 'Payload' },
        },
      },
      ErrorResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: false },
          message: { type: 'string', example: 'Invalid request' },
          errors: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                field: { type: 'string' },
                message: { type: 'string' },
              },
            },
          },
        },
      },
      Pagination: {
        type: 'object',
        properties: {
          page: { type: 'integer', example: 1 },
          limit: { type: 'integer', example: 10 },
          totalRecords: { type: 'integer', example: 42 },
          totalPages: { type: 'integer', example: 5 },
          hasNextPage: { type: 'boolean' },
          hasPreviousPage: { type: 'boolean' },
        },
      },
      Role: { type: 'string', enum: ['ADMIN', 'SALES_MANAGER', 'SALES_EXECUTIVE'] },
      LeadSource: {
        type: 'string',
        enum: ['WEBSITE', 'REFERRAL', 'SOCIAL_MEDIA', 'EMAIL', 'PHONE', 'OTHER'],
      },
      LeadStatus: {
        type: 'string',
        enum: ['NEW', 'CONTACTED', 'QUALIFIED', 'UNQUALIFIED', 'CONVERTED', 'LOST'],
      },
      LeadPriority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'] },
      DealStage: {
        type: 'string',
        enum: ['QUALIFICATION', 'DISCOVERY', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST'],
      },
      ActivityType: {
        type: 'string',
        enum: ['CALL', 'EMAIL', 'MEETING', 'DEMO', 'FOLLOW_UP', 'REMINDER', 'NOTE'],
      },
      ActivityStatus: {
        type: 'string',
        enum: ['PENDING', 'COMPLETED', 'OVERDUE'],
        description: 'OVERDUE is derived at read time from `dueDate`.',
      },
      ActivityRelatedEntityType: {
        type: 'string',
        enum: ['LEAD', 'CUSTOMER', 'DEAL', 'USER'],
      },
      TimelineEntityType: {
        type: 'string',
        enum: ['LEAD', 'CUSTOMER', 'DEAL', 'USER', 'ACTIVITY'],
      },
      User: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          email: { type: 'string', format: 'email' },
          phone: { type: 'string' },
          role: { $ref: '#/components/schemas/Role' },
          isActive: { type: 'boolean' },
          team: { type: 'string', nullable: true },
          lastLoginAt: { type: 'string', format: 'date-time', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      AuthResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          message: { type: 'string' },
          data: {
            type: 'object',
            properties: {
              user: { $ref: '#/components/schemas/User' },
              accessToken: { type: 'string' },
              refreshToken: { type: 'string' },
              tokenType: { type: 'string', example: 'Bearer' },
              expiresIn: { type: 'integer', example: 900 },
              expiresAt: { type: 'string', format: 'date-time' },
              refreshExpiresAt: { type: 'string', format: 'date-time' },
              activeSessions: { type: 'integer' },
            },
          },
        },
      },
      Lead: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          email: { type: 'string', format: 'email' },
          phone: { type: 'string' },
          company: { type: 'string' },
          source: { $ref: '#/components/schemas/LeadSource' },
          status: { $ref: '#/components/schemas/LeadStatus' },
          priority: { $ref: '#/components/schemas/LeadPriority' },
          assignedTo: {
            oneOf: [{ $ref: '#/components/schemas/User' }, { type: 'null' }],
          },
          description: { type: 'string' },
          createdBy: { $ref: '#/components/schemas/User' },
          convertedCustomer: { type: 'string', nullable: true },
          convertedDeal: { type: 'string', nullable: true },
          convertedAt: { type: 'string', format: 'date-time', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      Customer: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          email: { type: 'string', format: 'email' },
          phone: { type: 'string' },
          company: { type: 'string' },
          address: { type: 'string' },
          originalLead: { type: 'string', nullable: true },
          assignedTo: { $ref: '#/components/schemas/User' },
          status: { type: 'string', enum: ['ACTIVE', 'INACTIVE'] },
          origin: { type: 'string', enum: ['MANUAL', 'CONVERTED'] },
          notes: { type: 'string' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      Deal: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          lead: { type: 'string', nullable: true },
          customer: { $ref: '#/components/schemas/Customer' },
          assignedTo: { $ref: '#/components/schemas/User' },
          dealValue: { type: 'number', example: 25000 },
          probability: { type: 'integer', example: 60 },
          expectedRevenue: { type: 'number', example: 15000, description: 'Server computed: dealValue × probability / 100' },
          currency: { type: 'string', example: 'USD' },
          expectedClosingDate: { type: 'string', format: 'date-time' },
          stage: { $ref: '#/components/schemas/DealStage' },
          description: { type: 'string' },
          lostReason: { type: 'string' },
          createdBy: { $ref: '#/components/schemas/User' },
          closedAt: { type: 'string', format: 'date-time', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      Activity: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          type: { $ref: '#/components/schemas/ActivityType' },
          title: { type: 'string' },
          description: { type: 'string' },
          assignedTo: { $ref: '#/components/schemas/User' },
          dueDate: { type: 'string', format: 'date-time', nullable: true },
          status: { $ref: '#/components/schemas/ActivityStatus' },
          derivedStatus: {
            $ref: '#/components/schemas/ActivityStatus',
            description: 'Status computed at read time (this is what reports should use).',
          },
          relatedEntityType: { $ref: '#/components/schemas/ActivityRelatedEntityType' },
          relatedEntityId: { type: 'string' },
          createdBy: { $ref: '#/components/schemas/User' },
          completedAt: { type: 'string', format: 'date-time', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      TimelineEntry: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          action: { type: 'string', example: 'LEAD_STATUS_CHANGED' },
          entityType: { $ref: '#/components/schemas/TimelineEntityType' },
          entityId: { type: 'string' },
          entityLabel: { type: 'string' },
          performedBy: { $ref: '#/components/schemas/User' },
          previousValue: { type: 'object', nullable: true },
          newValue: { type: 'object', nullable: true },
          metadata: { type: 'object' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      Dashboard: {
        type: 'object',
        properties: {
          scope: { $ref: '#/components/schemas/Role' },
          currency: { type: 'string', example: 'USD' },
          leads: {
            type: 'object',
            properties: {
              total: { type: 'integer' },
              new: { type: 'integer' },
              contacted: { type: 'integer' },
              qualified: { type: 'integer' },
              converted: { type: 'integer' },
              unqualified: { type: 'integer' },
              lost: { type: 'integer' },
              eligible: { type: 'integer' },
              conversionRate: { type: 'number', example: 42.5 },
            },
          },
          customers: { type: 'object', properties: { total: { type: 'integer' } } },
          deals: {
            type: 'object',
            properties: {
              total: { type: 'integer' },
              open: { type: 'integer' },
              won: { type: 'integer' },
              lost: { type: 'integer' },
              totalValue: { type: 'number' },
              wonRevenue: { type: 'number', description: 'Actual revenue from WON deals' },
              openExpectedRevenue: { type: 'number', description: 'Weighted forecast of open deals' },
              weightedPipeline: { type: 'number' },
              averageDealValue: { type: 'number' },
              averageProbability: { type: 'number' },
              winRate: { type: 'number' },
            },
          },
          activities: {
            type: 'object',
            properties: {
              total: { type: 'integer' },
              pending: { type: 'integer' },
              overdue: { type: 'integer' },
              completed: { type: 'integer' },
            },
          },
          generatedAt: { type: 'string', format: 'date-time' },
        },
      },
      Pipeline: {
        type: 'object',
        properties: {
          currency: { type: 'string' },
          stages: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                stage: { $ref: '#/components/schemas/DealStage' },
                count: { type: 'integer' },
                totalValue: { type: 'number' },
                expectedRevenue: { type: 'number' },
                averageValue: { type: 'number' },
                averageProbability: { type: 'number' },
                isOpen: { type: 'boolean' },
              },
            },
          },
          totals: { type: 'object' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
      },
      TeamPerformance: {
        type: 'object',
        properties: {
          currency: { type: 'string' },
          scope: { $ref: '#/components/schemas/Role' },
          memberCount: { type: 'integer' },
          team: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                userId: { type: 'string' },
                name: { type: 'string' },
                email: { type: 'string' },
                role: { $ref: '#/components/schemas/Role' },
                assignedLeads: { type: 'integer' },
                convertedLeads: { type: 'integer' },
                qualifiedLeads: { type: 'integer' },
                openDeals: { type: 'integer' },
                wonDeals: { type: 'integer' },
                lostDeals: { type: 'integer' },
                wonRevenue: { type: 'number' },
                openExpectedRevenue: { type: 'number' },
                pendingActivities: { type: 'integer' },
                completedActivities: { type: 'integer' },
                leadConversionRate: { type: 'number' },
                dealWinRate: { type: 'number' },
              },
            },
          },
          totals: { type: 'object' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
      },
    },
  },
  security: [{ bearerAuth: [] }],
};

const options = {
  definition,
  // Glob patterns must use forward slashes on every platform.
  apis: [`${__dirname.replace(/\\/g, '/')}/../routes/*.js`],
};

/**
 * Shared error responses referenced by `$ref`, so every operation documents the
 * same error shape instead of repeating it inline.
 */
const ERROR_RESPONSES = {
  400: {
    description: 'Validation error (malformed body, query string or path parameter)',
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/ErrorResponse' },
        examples: {
          missingField: {
            summary: 'A required field is missing',
            value: {
              success: false,
              message: 'Request validation failed',
              code: 'VALIDATION_ERROR',
              errors: [{ field: 'email', message: 'email is required', code: 'invalid_type' }],
            },
          },
          unknownField: {
            summary: 'A field the endpoint does not accept was sent',
            value: {
              success: false,
              message: 'Request validation failed',
              code: 'VALIDATION_ERROR',
              errors: [
                { field: 'role', message: 'Unexpected field(s) not allowed: "role"', code: 'unrecognized_keys' },
              ],
            },
          },
        },
      },
    },
  },
  401: {
    description: 'Missing, invalid or expired access token',
    content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
  },
  403: {
    description: 'Authenticated but not allowed to perform this action',
    content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
  },
  404: {
    description: 'Resource not found, or not visible to the caller',
    content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
  },
  409: {
    description: 'Conflict with the current state (duplicate or already converted)',
    content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
  },
  422: {
    description: 'Business rule violation',
    content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
  },
  429: {
    description: 'Too many requests',
    content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
  },
  500: {
    description: 'Unexpected server error',
    content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
  },
};

/**
 * Guarantee that every operation documents the error responses the API can
 * actually return for it.
 *
 * The JSDoc blocks describe the *interesting* outcomes per endpoint; this pass
 * adds the universal ones so the documentation never shows an undocumented
 * status code (for example a `400` from query validation on a `GET`).
 */
function withDefaultErrorResponses(spec) {
  const httpMethods = new Set(['get', 'put', 'post', 'patch', 'delete', 'head', 'options']);

  for (const item of Object.values(spec.paths || {})) {
    for (const [method, operation] of Object.entries(item)) {
      if (!httpMethods.has(method.toLowerCase())) continue;

      // `security: []` marks a deliberately public operation.
      const isPublic = Array.isArray(operation.security) && operation.security.length === 0;

      const defaults = ['400'];
      if (!isPublic) defaults.push('401');

      for (const status of defaults) {
        if (operation.responses?.[status]) continue;
        operation.responses[status] = { ...ERROR_RESPONSES[status] };
      }
    }
  }

  return spec;
}

/**
 * Build the OpenAPI specification object.
 */
export function buildSwaggerSpec() {
  return withDefaultErrorResponses(swaggerJsdoc(options));
}

export const swaggerSpec = buildSwaggerSpec();

export default swaggerSpec;