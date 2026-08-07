import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, type FieldValues, type Resolver, type UseFormProps } from "react-hook-form";
import type { z } from "zod";

/**
 * React Hook Form + Zod, wired once (midday-ai's `useZodForm` shape): every
 * form passes its schema here instead of repeating the resolver setup. Field
 * types are the schema's input; submitted values are its output.
 */
export function useZodForm<T extends z.ZodType<FieldValues, FieldValues>>(
  schema: T,
  options?: Omit<UseFormProps<z.input<T>, unknown, z.output<T>>, "resolver">,
) {
  return useForm<z.input<T>, unknown, z.output<T>>({
    // The resolver generics mirror the useForm call exactly; the cast only
    // bridges @hookform/resolvers' zod-version overloads.
    resolver: zodResolver(schema as never) as Resolver<z.input<T>, unknown, z.output<T>>,
    ...options,
  });
}
