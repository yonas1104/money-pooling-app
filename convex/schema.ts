import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// Enum for user roles, including specific tenant admin roles
export const userRoles = v.union(
  v.literal("PlatformAdmin"),
  v.literal("TenantAdmin_Manager"),
  v.literal("TenantAdmin_HR"),
  v.literal("TenantAdmin_Sales"),
  v.literal("TenantAdmin_Marketing"),
  v.literal("TenantAdmin_Support"),
  v.literal("TenantAdmin_Finance"),
  v.literal("RegularUser")
);

// Enum for transaction types
export const transactionTypes = v.union(
  v.literal("Deposit"),
  v.literal("Withdrawal"),
  v.literal("GameEntry"),
  v.literal("GamePayout"),
  v.literal("CommissionEarned"),
  v.literal("ReferralBonus")
);

// Enum for payment request status
export const paymentRequestStatus = v.union(
  v.literal("Pending"),
  v.literal("Verified"),
  v.literal("Rejected")
);

// Enum for game status
export const gameStatus = v.union(
  v.literal("Pending"), // Created but not yet open for joining
  v.literal("Open"), // Open for joining
  v.literal("Filling"), // Open for joining, but close to max players
  v.literal("Full"), // Max players reached, waiting to start
  v.literal("Active"), // Game started, spinning wheel active
  v.literal("Completed"), // Winner selected, payouts processed
  v.literal("Cancelled") // Game cancelled
);

// Enum for notification channels
export const notificationChannels = v.union(
  v.literal("InApp"),
  v.literal("Telegram"),
  v.literal("Email")
);

// Enum for referral campaign status
export const referralCampaignStatus = v.union(
  v.literal("Active"),
  v.literal("Paused"),
  v.literal("Completed")
);

export default defineSchema({
  // Users table: Stores all users (Platform Admins, Tenant Admins, Regular Users)
  users: defineTable({
    clerkId: v.optional(v.string()), // For Clerk authentication if used, otherwise custom email/password for admins
    telegramId: v.optional(v.string()), // Unique ID from Telegram for Regular Users
    telegramUsername: v.optional(v.string()),
    name: v.string(),
    email: v.optional(v.string()), // Optional for Telegram users, required for email/password users
    passwordHash: v.optional(v.string()), // Hashed password for email/password users
    role: userRoles, // User's role (PlatformAdmin, TenantAdmin, RegularUser)
    tenantId: v.optional(v.id("tenants")), // For Tenant Admins and Regular Users
    profilePictureUrl: v.optional(v.string()),
    lastLogin: v.number(), // Timestamp
    isActive: v.boolean(), // Can be banned/suspended
    onboardingCompleted: v.boolean(), // For Regular Users
    telegramNotificationsEnabled: v.boolean(),
    inAppNotificationsEnabled: v.boolean(),
    referralCode: v.string(), // Unique referral code for the user
    referredBy: v.optional(v.string()), // Referral code of the user who referred them
  })
    .index("by_clerkId", ["clerkId"])
    .index("by_telegramId", ["telegramId"])
    .index("by_email", ["email"])
    .index("by_role", ["role"])
    .index("by_tenantId", ["tenantId"]),

  // Tenants table: For multi-tenancy, each organization is a tenant
  tenants: defineTable({
    name: v.string(),
    status: v.union(v.literal("Active"), v.literal("Suspended"), v.literal("Pending")),
    managerEmail: v.string(), // Initial manager email for setup
    settings: v.object({
      commissionRate: v.number(), // Default commission rate for this tenant
      paymentProvider: v.optional(v.string()), // e.g., "Stripe", "Canyopay"
      paymentProviderConfig: v.optional(v.any()), // JSON blob for provider specific config
      // ... other tenant-specific settings
    }),
  })
    .index("by_name", ["name"])
    .index("by_status", ["status"]),

  // Employees table: Tenant-specific administrators/staff (mapped to users table)
  // This table links a user_id to a specific tenant and a specific tenant-level role.
  employees: defineTable({
    userId: v.id("users"),
    tenantId: v.id("tenants"),
    role: userRoles, // Should be a TenantAdmin role
    isActive: v.boolean(),
  })
    .index("by_userId", ["userId"])
    .index("by_tenantId", ["tenantId"])
    .index("by_tenantId_userId", ["tenantId", "userId"])
    .index("by_tenantId_role", ["tenantId", "role"]),

  // Games table: Stores details about each money pooling game
  games: defineTable({
    tenantId: v.id("tenants"),
    name: v.string(),
    entryFee: v.number(), // Amount in smallest currency unit (e.g., cents)
    maxPlayers: v.number(),
    description: v.optional(v.string()),
    status: gameStatus,
    currentPlayers: v.number(), // Denormalized count for quick queries
    participants: v.array(v.object({ // Array of objects for participants
      userId: v.id("users"),
      selectedNumber: v.number(), // The number chosen by the player
      joinedAt: v.number(), // Timestamp of joining
      isWinner: v.optional(v.boolean()),
    })),
    startTime: v.optional(v.number()), // When the game actually started
    endTime: v.optional(v.number()), // When the game ended and winner was selected
    winnerId: v.optional(v.id("users")),
    winningNumber: v.optional(v.number()),
    commissionEarned: v.optional(v.number()), // Amount of commission for this game
    // Add game rules, eg. min/max number, etc.
  })
    .index("by_tenantId", ["tenantId"])
    .index("by_status", ["status"])
    .index("by_tenantId_status", ["tenantId", "status"]),

  // Game Templates table: Reusable templates for creating games
  gameTemplates: defineTable({
    tenantId: v.id("tenants"),
    name: v.string(),
    defaultEntryFee: v.number(),
    defaultMaxPlayers: v.number(),
    description: v.optional(v.string()),
  })
    .index("by_tenantId", ["tenantId"]),

  // Wallets table: Stores current balance for each user and tenant
  wallets: defineTable({
    ownerId: v.id("users"), // User ID for player wallets
    tenantId: v.optional(v.id("tenants")), // Tenant ID for organization wallets
    balance: v.number(), // Current balance in smallest currency unit
    type: v.union(v.literal("User"), v.literal("Tenant"), v.literal("Platform")), // Differentiate wallet types
  })
    .index("by_ownerId", ["ownerId"])
    .index("by_tenantId", ["tenantId"])
    .index("by_type", ["type"])
    .index("by_ownerId_type", ["ownerId", "type"]), // For quick lookup of user's wallet

  // Transactions table: Records all money movements
  transactions: defineTable({
    userId: v.optional(v.id("users")), // User involved in the transaction
    tenantId: v.optional(v.id("tenants")), // Tenant involved (for game entries, payouts, tenant wallet txns)
    type: transactionTypes,
    amount: v.number(), // Positive for income, negative for expense
    description: v.string(),
    status: v.union(v.literal("Pending"), v.literal("Completed"), v.literal("Failed"), v.literal("Reversed")),
    relatedGameId: v.optional(v.id("games")), // If transaction is related to a game
    relatedPaymentId: v.optional(v.id("payments")), // If transaction is related to a payment request
    relatedTransactionId: v.optional(v.id("transactions")), // For linking reversals etc.
  })
    .index("by_userId", ["userId"])
    .index("by_tenantId", ["tenantId"])
    .index("by_type", ["type"])
    .index("by_status", ["status"])
    .index("by_userId_type", ["userId", "type"])
    .index("by_tenantId_type", ["tenantId", "type"]),

  // Payments table: Records user top-up requests needing verification
  payments: defineTable({
    userId: v.id("users"),
    tenantId: v.id("tenants"), // The tenant the user belongs to
    amount: v.number(),
    screenshotId: v.id("_storage"), // Convex file storage ID for the screenshot
    status: paymentRequestStatus,
    paymentMethod: v.string(), // e.g., "Bank Transfer", "Mobile Money"
    referenceCode: v.string(), // User provided reference
    verificationNotes: v.optional(v.string()), // Admin notes during verification
    verifiedBy: v.optional(v.id("users")), // Admin who verified
    verifiedAt: v.optional(v.number()), // Timestamp of verification
  })
    .index("by_userId", ["userId"])
    .index("by_tenantId", ["tenantId"])
    .index("by_status", ["status"])
    .index("by_tenantId_status", ["tenantId", "status"]),

  // Notifications table: In-app notifications for users/admins
  notifications: defineTable({
    userId: v.id("users"), // Target user
    tenantId: v.optional(v.id("tenants")), // Tenant context for tenant-scoped notifications
    type: v.union(v.literal("GameUpdate"), v.literal("Wallet"), v.literal("System"), v.literal("Marketing")),
    title: v.string(),
    message: v.string(),
    isRead: v.boolean(),
    channel: notificationChannels, // Primary channel for this notification (e.g., InApp, Telegram)
    relatedEntityId: v.optional(v.id("games")), // Can link to a game, transaction, etc.
  })
    .index("by_userId", ["userId"])
    .index("by_tenantId", ["tenantId"])
    .index("by_userId_isRead", ["userId", "isRead"])
    .index("by_tenantId_isRead", ["tenantId", "isRead"]),

  // Audit Logs table: Records critical actions for accountability
  auditLogs: defineTable({
    actorId: v.id("users"), // User who performed the action
    actorRole: userRoles,
    tenantId: v.optional(v.id("tenants")), // Tenant context if action is tenant-scoped
    actionType: v.string(), // e.g., "USER_CREATED", "GAME_UPDATED", "PAYMENT_VERIFIED"
    resourceType: v.string(), // e.g., "User", "Game", "Payment"
    resourceId: v.optional(v.id("any")), // ID of the affected resource
    details: v.any(), // JSON object with relevant details (e.g., old/new values)
  })
    .index("by_actorId", ["actorId"])
    .index("by_tenantId", ["tenantId"])
    .index("by_actionType", ["actionType"])
    .index("by_resourceId", ["resourceId"])
    .index("by_creationTime", ["_creationTime"]), // Default index for time-based queries

  // Platform Settings table: Global configurations
  platformSettings: defineTable({
    key: v.string(), // e.g., "globalCommissionRate", "maintenanceMode"
    value: v.any(), // Stored as any, can be number, string, object
    description: v.optional(v.string()),
  })
    .index("by_key", ["key"]),

  // Commission Overrides table: Tenant-specific commission rates
  commissionOverrides: defineTable({
    tenantId: v.id("tenants"),
    rate: v.number(), // The specific rate for this tenant
    startDate: v.number(), // Timestamp
    endDate: v.optional(v.number()), // Optional end date
  })
    .index("by_tenantId", ["tenantId"])
    .index("by_startDate", ["startDate"]),

  // Referral Campaigns table: Manages different referral programs
  referralCampaigns: defineTable({
    tenantId: v.id("tenants"), // Which tenant created this campaign
    name: v.string(),
    code: v.string(), // Unique campaign code
    status: referralCampaignStatus,
    rewardType: v.union(v.literal("FlatAmount"), v.literal("Percentage")),
    rewardValue: v.number(), // e.g., 500 (cents) or 0.05 (5%)
    minReferredDeposit: v.optional(v.number()), // Minimum deposit for reward eligibility
    startDate: v.number(),
    endDate: v.optional(v.number()),
    description: v.optional(v.string()),
  })
    .index("by_tenantId", ["tenantId"])
    .index("by_code", ["code"]),

  // Support Tickets table: For user/admin support requests
  supportTickets: defineTable({
    userId: v.id("users"), // User who submitted the ticket
    tenantId: v.optional(v.id("tenants")), // Tenant context if applicable
    subject: v.string(),
    message: v.string(),
    status: v.union(v.literal("Open"), v.literal("Pending"), v.literal("Closed")),
    priority: v.union(v.literal("Low"), v.literal("Medium"), v.literal("High")),
    assignedTo: v.optional(v.id("users")), // Admin/Employee ID
    replies: v.array(v.object({
      userId: v.id("users"), // User or Admin who replied
      message: v.string(),
      timestamp: v.number(),
    })),
    attachments: v.optional(v.array(v.id("_storage"))), // IDs of attached files
  })
    .index("by_userId", ["userId"])
    .index("by_tenantId", ["tenantId"])
    .index("by_status", ["status"])
    .index("by_assignedTo", ["assignedTo"]),
});