import { z } from 'zod'

// Claude Code hooks send `session_id` and `hook_event_name`; Codex's `notify` sends `type`
// and `thread-id`. A cloud session's prompt and final replies are kept in memory for its chat;
// anything else in the payload is dropped, not stored.
export const hookPayloadSchema = z.object({
  session_id: z.string().min(1).max(200).optional(),
  hook_event_name: z.string().max(100).optional(),
  type: z.string().max(100).optional(),
  'thread-id': z.string().min(1).max(200).optional(),
  prompt: z.string().optional(),
  last_assistant_message: z.string().optional(),
  'input-messages': z.array(z.string()).optional(),
  cwd: z.string().max(4096).optional(),
})

const anyValueSchema = z.object({
  stringValue: z.string().optional(),
  intValue: z.union([z.string(), z.number()]).optional(),
  doubleValue: z.number().optional(),
  boolValue: z.boolean().optional(),
})

export const keyValueSchema = z.object({ key: z.string(), value: anyValueSchema })

const numberDataPointSchema = z.object({
  attributes: z.array(keyValueSchema).default([]),
  startTimeUnixNano: z.union([z.string(), z.number()]).optional(),
  timeUnixNano: z.union([z.string(), z.number()]).optional(),
  asInt: z.union([z.string(), z.number()]).optional(),
  asDouble: z.number().optional(),
})

const metricSchema = z.object({
  name: z.string(),
  sum: z
    .object({
      dataPoints: z.array(numberDataPointSchema).default([]),
      aggregationTemporality: z.union([z.number(), z.string()]).optional(),
    })
    .optional(),
})

// The OTLP/HTTP JSON encoding of an ExportMetricsServiceRequest, reduced to what the token
// counts need: sums with their attributes.
export const otlpMetricsSchema = z.object({
  resourceMetrics: z
    .array(
      z.object({
        resource: z.object({ attributes: z.array(keyValueSchema).default([]) }).optional(),
        scopeMetrics: z.array(z.object({ metrics: z.array(metricSchema).default([]) })).default([]),
      }),
    )
    .default([]),
})
