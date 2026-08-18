import { z } from "zod";
import { FIELD_LIMITS } from "./badge-template.js";

/**
 * One schema, used by both the browser form and the API route.
 *
 * The client-side check exists for UX — instant feedback, no round trip. The
 * server-side check exists for safety. They are the same rules deliberately, so
 * a user never sees "valid" in the form and then a rejection from the chain,
 * but the server never trusts that the client ran them.
 */

/** Mirrors _check() in ExitBadge.sol: strip rather than escape, because the
 *  same string is interpolated into both XML and JSON and no single escaping is
 *  correct for both. */
const ILLEGAL = /[\u0000-\u001f\u007f<>&"\\]/;

const text = (max: number, label: string) =>
  z.string()
    .trim()
    .min(1, `${label} is required`)
    .max(max, `${label} must be ${max} characters or fewer`)
    .refine((v) => !ILLEGAL.test(v), {
      message: `${label} cannot contain < > & " or \\`,
    });

const isoDate = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the date picker (YYYY-MM-DD)")
  .refine((v) => {
    const d = new Date(v + "T00:00:00Z");
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, "That date does not exist");

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export const badgeFormSchema = z.object({
  firstName: text(FIELD_LIMITS.firstName, "First name"),
  lastName: text(FIELD_LIMITS.lastName, "Last name"),
  mainProject: text(FIELD_LIMITS.mainProject, "Main project"),
  startDate: isoDate,
  completionDate: isoDate,
  details: text(FIELD_LIMITS.details, "Details"),
  recipient: z.string()
    .regex(/^0x[a-fA-F0-9]{40}$/, "That is not a valid wallet address")
    .refine((v) => v.toLowerCase() !== ZERO_ADDRESS, {
      message: "Tokens sent to the zero address are unrecoverable",
    }),
}).refine((v) => v.completionDate >= v.startDate, {
  message: "Completion date cannot be before the start date",
  path: ["completionDate"],
});

/** The mint request: form fields plus exactly one image source. */
export const mintRequestSchema = z.object({
  firstName: text(FIELD_LIMITS.firstName, "First name"),
  lastName: text(FIELD_LIMITS.lastName, "Last name"),
  mainProject: text(FIELD_LIMITS.mainProject, "Main project"),
  startDate: isoDate,
  completionDate: isoDate,
  details: text(FIELD_LIMITS.details, "Details"),
  recipient: z.string()
    .regex(/^0x[a-fA-F0-9]{40}$/, "That is not a valid wallet address")
    .refine((v) => v.toLowerCase() !== ZERO_ADDRESS, {
      message: "Tokens sent to the zero address are unrecoverable",
    }),
  // Either a URL we fetch server-side, or a data URI the browser already
  // resized. Exactly one must be present.
  imageUrl: z.string().url().optional(),
  imageDataUri: z.string().startsWith("data:image/").optional(),
  chain: z.enum(["amoy", "polygon"]).default("amoy"),
}).refine((v) => Boolean(v.imageUrl) !== Boolean(v.imageDataUri), {
  message: "Provide either an image link or an uploaded image",
  path: ["imageUrl"],
});

export type BadgeFormValues = z.infer<typeof badgeFormSchema>;
export type MintRequest = z.infer<typeof mintRequestSchema>;

export type MintSuccess = {
  ok: true;
  tokenId: string;
  txHash: `0x${string}`;
  explorerUrl: string;
  status: "confirmed" | "pending";
  imageBytes: number;
  gasUsed?: string;
};

export type MintFailure = {
  ok: false;
  code: string;
  message: string;
};
