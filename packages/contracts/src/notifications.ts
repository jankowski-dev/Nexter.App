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

export const notificationsListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export type Notification = z.infer<typeof notificationSchema>;
export type NotificationsResponse = z.infer<typeof notificationsResponseSchema>;
export type NotificationUnreadCount = z.infer<typeof notificationUnreadCountSchema>;
export type NotificationsReadAllResponse = z.infer<typeof notificationsReadAllResponseSchema>;
export type NotificationsListQuery = z.infer<typeof notificationsListQuerySchema>;
