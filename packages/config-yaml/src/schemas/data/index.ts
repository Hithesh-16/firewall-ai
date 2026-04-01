import * as z from "zod";

export const dataSchema = z.object({
  provider: z.string().optional(),
  name: z.string().optional(),
  destination: z.string().optional(),
  schema: z.any().optional(),
  params: z.any().optional(),
  requestOptions: z.any().optional(),
});

export type Data = z.infer<typeof dataSchema>;

export interface DevDataLogEvent {
  tableName?: string;
  name?: string;
  data?: any;
  [key: string]: any;
}

export type DevEventName = string;
