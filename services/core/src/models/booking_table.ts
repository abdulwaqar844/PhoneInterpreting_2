/* eslint-disable indent */
/* eslint-disable @typescript-eslint/indent */
import {
  pgTable, uuid, varchar, timestamp, decimal, text,
} from 'drizzle-orm/pg-core';
import { mediator } from './mediator';
import { RequestTable } from './request_table';
import { Users } from './user_table';

export const Bookings = pgTable('booking', {
  id: uuid('id').primaryKey(),
  requestId: uuid('requestId')
    .notNull()
    .references(() => RequestTable.id, { onUpdate: 'cascade' }),
  mediatorId: uuid('mediatorId')
    .notNull()
    .references(() => mediator.id, { onUpdate: 'cascade' }),
  addedBy: uuid('addedBy')
    .references(() => Users.id, { onUpdate: 'cascade' }),
  status: varchar('status', { length: 255 }).notNull(),
  deliveryDate: timestamp('deliveryDate').notNull(),
  mediationType: varchar('mediationType', { length: 255 }).default('Programmata'),
  language: text('language'),
  minutes: decimal('minutes').default('0'),
  notes: varchar('notes', { length: 255 }).default(''),
  amount: decimal('amount', { precision: 10, scale: 2 }),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  formUrl: varchar('formUrl', { length: 255 }).default(''),
  additionalMinutes: decimal('additionalMinutes').default('0'),
  dateOfRequestCompletion: timestamp('dateOfRequestCompletion'),
  updatedAt: timestamp('updatedAt')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
