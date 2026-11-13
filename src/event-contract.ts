import { z } from 'zod';
import { calendarDateSchema } from './schedule.js';
import { eventTemplateSchema, recurrenceDefinitionSchema } from './event-model.js';

export const eventChangesSchema = z
  .object({
    title: eventTemplateSchema.shape.title,
    date: calendarDateSchema,
    type: eventTemplateSchema.shape.type,
    notes: eventTemplateSchema.shape.notes.removeDefault(),
    location: eventTemplateSchema.shape.location.removeDefault(),
    teacher: eventTemplateSchema.shape.teacher.removeDefault(),
    color: eventTemplateSchema.shape.color.removeDefault(),
    allDay: eventTemplateSchema.shape.allDay,
    periods: eventTemplateSchema.shape.periods,
    precision: eventTemplateSchema.shape.precision,
    durationDays: eventTemplateSchema.shape.durationDays.removeDefault(),
    timeZone: eventTemplateSchema.shape.timeZone,
  })
  .partial()
  .strict();
export const eventInputSchema = eventChangesSchema.required({ title: true, date: true });
export const recurrenceInputSchema = z
  .object({
    definitions: z.array(recurrenceDefinitionSchema).min(1).max(100),
    enabled: z.boolean().default(true),
    dateOffsets: z.array(z.number().int().min(0).max(365)).min(1).max(366).default([0]),
  })
  .strict();
