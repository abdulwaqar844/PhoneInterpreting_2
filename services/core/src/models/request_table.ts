/* eslint-disable object-curly-newline */
/* eslint-disable indent */
/* eslint-disable @typescript-eslint/indent */import {
  pgTable,
  serial,
  text,
  varchar,
  timestamp,
  uuid,
  decimal,
  jsonb,
} from 'drizzle-orm/pg-core';

import { Users } from './user_table';

export const RequestTable = pgTable('request', {
  id: uuid('id').primaryKey(),
  requestId: serial('requestId').notNull(), // Changed to serial for auto-increment
  status: varchar('status', { length: 255 }).notNull(),
  customer: varchar('customer', { length: 255 }).notNull(),
  userId: uuid('userId')
    .notNull()
    .references(() => Users.id),
  assignedUser: uuid('assignedUser').references(() => Users.id),
  dateOfRequestCompletion: timestamp('dateOfRequestCompletion'),
  applicantFirstName: varchar('applicantFirstName', { length: 255 }),
  applicantLastName: varchar('applicantLastName', { length: 255 }),
  applicantEmail: varchar('applicantEmail', { length: 255 }),
  applicantPhone: varchar('applicantPhone', { length: 255 }),
  applicantOtherEmail: jsonb('applicantOtherEmail'),
  applicantOtherPhone: jsonb('applicantOtherPhone'),
  operationalUnits: text('operationalUnits'),
  structurePavilionAddress: varchar('structurePavilionAddress', { length: 255 }),
  floor: varchar('floor', { length: 255 }),
  office: varchar('office', { length: 255 }),
  dateOfIntervention: timestamp('dateOfIntervention'),
  mediationType: varchar('mediationType', { length: 255 }),
  mediationCategory: varchar('mediationCategory', { length: 255 }),
  patientIndication: text('patientIndication'),
  targetLanguage: text('targetLanguage'),
  expectedDuration: decimal('expectedDuration'),
  amount: decimal('amount'),
  motivation: text('motivation'),
  otherMotivation: text('otherMotivation'),
  notes: text('notes'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt')
    .notNull()
    .$onUpdate(() => new Date()),
  preferredMediator: text('preferredMediator'),
  mediatorInfo: text('mediatorInfo'),
  patientFirstName: varchar('patientFirstName', { length: 255 }),
  patientLastName: varchar('patientLastName', { length: 255 }),
});
