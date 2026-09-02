/* eslint-disable object-curly-newline */
/* eslint-disable indent */
/* eslint-disable @typescript-eslint/indent */
import {
  pgTable,
  serial,
  text,
  varchar,
  timestamp,
  uuid,
  decimal,
  jsonb,
} from 'drizzle-orm/pg-core';

export const RequestTable = pgTable('request', {
  id: uuid('id').primaryKey(),
  requestNo: serial('requestNo').notNull(),
  status: varchar('status', { length: 255 }).notNull(),

  dateOfMediation: timestamp('dateOfMediation'),
  targetLanguage: text('targetLanguage'),
  duration: decimal('duration'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt')
    .notNull()
    .$onUpdate(() => new Date()),
  mediator: text('preferredMediator'),
});
