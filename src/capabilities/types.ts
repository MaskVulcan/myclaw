import type { z } from "zod";

export type CapabilityDisclosureMode = "capabilities-first" | "full";

export type CapabilitySideEffect =
  | "none"
  | "filesystem-read"
  | "filesystem-write"
  | "network"
  | "config-read"
  | "config-write";

export type CapabilityDescriptor<
  TInputSchema extends z.ZodTypeAny = z.ZodTypeAny,
  TOutputSchema extends z.ZodTypeAny = z.ZodTypeAny,
> = {
  id: string;
  title: string;
  summary: string;
  category: string;
  tags: string[];
  disclosureMode: CapabilityDisclosureMode;
  skillSummary: string;
  sideEffects: CapabilitySideEffect[];
  idempotent: boolean;
  dryRunSupported: boolean;
  requiresConfirmation: boolean;
  underlyingCliCommand: string[];
  examples: string[];
  inputSchema: TInputSchema;
  outputSchema: TOutputSchema;
  execute: (input: z.output<TInputSchema>) => Promise<z.output<TOutputSchema>>;
};

export type CapabilityJsonSchema = Record<string, unknown>;

export type CapabilitySummary = {
  id: string;
  title: string;
  summary: string;
  category: string;
  tags: string[];
  disclosureMode: CapabilityDisclosureMode;
  skillSummary: string;
  sideEffects: CapabilitySideEffect[];
  idempotent: boolean;
  dryRunSupported: boolean;
  requiresConfirmation: boolean;
  underlyingCliCommand: string[];
};

export type CapabilityDescription = CapabilitySummary & {
  inputSchema: CapabilityJsonSchema;
  outputSchema: CapabilityJsonSchema;
  examples: string[];
};
