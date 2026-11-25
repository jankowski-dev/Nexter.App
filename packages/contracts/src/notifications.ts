import { z } from 'zod';

export const notificationSchema = z.object({
  id: z.uuid(),
  type: z.string().min(1),
  title: z.string().min(1),
  body: z.string(),
  href: z.string().nullable(),
  payload: z.record(z.string(), z.unknown()),
  readAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});

export const notificationsResponseSchema = z.object({
  data: z.array(notificationSchema),
  unreadCount: z.number().int().nonnegative(),
});

export const notificationUnreadCountSchema = z.object({
  count: z.number().int().nonnegative(),
});

export const notificationsReadAllResponseSchema = z.object({
  updated: z.number().int().nonnegative(),
});

export const notificationsClearResponseSchema = z.object({
  cleared: z.number().int().nonnegative(),
});

export const notificationsListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export type Notification = z.infer<typeof notificationSchema>;
export type NotificationsResponse = z.infer<typeof notificationsResponseSchema>;
export type NotificationUnreadCount = z.infer<typeof notificationUnreadCountSchema>;
export type NotificationsReadAllResponse = z.infer<typeof notificationsReadAllResponseSchema>;
export type NotificationsClearResponse = z.infer<typeof notificationsClearResponseSchema>;
export type NotificationsListQuery = z.infer<typeof notificationsListQuerySchema>;

export const viberFrequencySchema = z.enum(['instant', 'hourly', 'daily']);
export const viberNotificationStatusSchema = z.enum(['pending', 'sent', 'failed']);

export const viberNotificationSchema = z.object({
  id: z.uuid(),
  type: z.string().min(1),
  title: z.string().min(1),
  body: z.string(),
  payload: z.record(z.string(), z.unknown()),
  status: viberNotificationStatusSchema,
  attempts: z.number().int().nonnegative(),
  error: z.string().nullable(),
  sentAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});

export const viberPendingResponseSchema = z.object({
  items: z.array(viberNotificationSchema),
  frequency: viberFrequencySchema,
  digestTime: z.string(),
  timezone: z.string(),
});

export const viberAckRequestSchema = z.object({
  status: z.enum(['sent', 'failed']),
  error: z.string().trim().max(500).optional(),
});

export const viberAckResponseSchema = z.object({
  id: z.uuid(),
  status: viberNotificationStatusSchema,
});

export const viberTestResponseSchema = z.object({ id: z.uuid() });

export const viberStatusResponseSchema = z.object({
  configured: z.boolean(),
  pending: z.number().int().nonnegative(),
  sent24h: z.number().int().nonnegative(),
  failed24h: z.number().int().nonnegative(),
  lastSentAt: z.iso.datetime().nullable(),
  lastError: z.string().nullable(),
});

export const viberListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export const viberListResponseSchema = z.object({
  data: z.array(viberNotificationSchema),
});

export type ViberFrequency = z.infer<typeof viberFrequencySchema>;
export type ViberNotificationStatus = z.infer<typeof viberNotificationStatusSchema>;
export type ViberNotification = z.infer<typeof viberNotificationSchema>;
export type ViberPendingResponse = z.infer<typeof viberPendingResponseSchema>;
export type ViberAckRequest = z.infer<typeof viberAckRequestSchema>;
export type ViberAckResponse = z.infer<typeof viberAckResponseSchema>;
export type ViberTestResponse = z.infer<typeof viberTestResponseSchema>;
export type ViberStatusResponse = z.infer<typeof viberStatusResponseSchema>;
export type ViberListQuery = z.infer<typeof viberListQuerySchema>;
export type ViberListResponse = z.infer<typeof viberListResponseSchema>;
