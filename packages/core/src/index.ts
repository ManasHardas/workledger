import { z } from "zod";

/**
 * Version stamped into the `schema_version` frontmatter key of every ledger artifact.
 * Slot 2 grows the real schemas (`CheckpointPayload`, `SessionFrontmatter`, `BacklogItem`)
 * on top of this module.
 */
export const SCHEMA_VERSION = 1;

/** Guard for the `schema_version` key carried by every ledger file and payload. */
export const schemaVersionSchema = z.literal(SCHEMA_VERSION);

export type SchemaVersion = z.infer<typeof schemaVersionSchema>;
