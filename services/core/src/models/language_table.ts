import { pgTable, serial, varchar, integer, unique, timestamp, uuid } from 'drizzle-orm/pg-core';

export const Languages = pgTable('languages', {
  id: uuid('id').primaryKey(),
  language_code: integer('language_code').unique().notNull(),
  language_name: varchar('language_name', { length: 100 }).notNull(),
  created_at: timestamp('created_at').defaultNow(),
  updated_at: timestamp('updated_at').defaultNow(),
});
