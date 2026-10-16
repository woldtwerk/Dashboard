import { z } from 'zod'

const contactValueSchema = z.object({
  value: z.string().trim().min(1).max(500),
  label: z.string().trim().max(50).optional()
})

const contactAddressSchema = z.object({
  street: z.string().trim().max(500).optional(),
  city: z.string().trim().max(200).optional(),
  region: z.string().trim().max(200).optional(),
  postalCode: z.string().trim().max(50).optional(),
  country: z.string().trim().max(200).optional(),
  label: z.string().trim().max(50).optional()
})

export const contactsQuerySchema = z.object({
  service: z.string().min(1).optional(),
  /** Address book URL; without it every address book of the service is listed */
  addressBook: z.string().min(1).optional(),
  q: z.string().trim().max(200).optional()
})

export const addressBooksQuerySchema = z.object({
  service: z.string().min(1).optional()
})

export const contactBodySchema = z.object({
  service: z.string().min(1),
  addressBook: z.string().min(1),
  name: z.string().trim().max(500).optional(),
  firstName: z.string().trim().max(200).optional(),
  lastName: z.string().trim().max(200).optional(),
  emails: z.array(contactValueSchema).max(50).default([]),
  phones: z.array(contactValueSchema).max(50).default([]),
  addresses: z.array(contactAddressSchema).max(20).default([]),
  organization: z.string().trim().max(500).optional(),
  jobTitle: z.string().trim().max(200).optional(),
  birthday: z.string().trim().max(20).optional(),
  notes: z.string().trim().max(20_000).optional(),
  photo: z.string().max(5_000_000).optional()
})

export const contactUpdateSchema = contactBodySchema.extend({
  url: z.string().url().optional(),
  etag: z.string().optional()
})

export const contactDeleteSchema = z.object({
  service: z.string().min(1),
  addressBook: z.string().min(1),
  url: z.string().url().optional(),
  etag: z.string().optional()
})
