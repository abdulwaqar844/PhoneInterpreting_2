/* eslint-disable object-curly-newline */
/* eslint-disable indent */
/* eslint-disable @typescript-eslint/indent */
import { sql } from 'drizzle-orm';
import { pgTable, uuid, varchar, timestamp, text } from 'drizzle-orm/pg-core';

export const Users = pgTable('users', {
  id: uuid('id').primaryKey(),
  firstName: varchar('firstName'),
  lastName: varchar('lastName'),
  customer: text('customer')
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  email: text('email').notNull().unique(),
  password: varchar('password'),
  requestPermissionPassword: varchar('requestPermissionPassword'),
  fatturazionePassword: varchar('fatturazionePassword'),
  role: varchar('role'),
  phone: varchar('phone'),
  department: varchar('department'),
  type: text('type'),
  avatarUrl: varchar('avatarUrl'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt')
    .notNull()
    .$onUpdate(() => new Date()),
});
