import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, type FieldValues, type Resolver, type UseFormProps } from "react-hook-form";
import type { z } from "zod";

// Field types are the schema's input; submitted values are its output. Generic over the
// schema rather than over Input/Output so callers that are themselves generic over a
// schema (FormDialog) keep the link between the two.
export function useZodForm<T extends z.ZodType<FieldValues, FieldValues>>(
  schema: T,
  options?: Omit<UseFormProps<z.input<T>, unknown, z.output<T>>, "resolver">,
) {
  return useForm<z.input<T>, unknown, z.output<T>>({
    // SAFETY: `zodResolver`'s overloads cannot resolve against a still-generic schema, so
    // neither the argument nor the result type can be inferred here. `T` is constrained to
    // a Zod schema over FieldValues, and the resolver is declared with that schema's own
    // input and output, so the bridged types are the ones `useForm` is instantiated with.
    resolver: zodResolver(schema as never) as Resolver<z.input<T>, unknown, z.output<T>>,
    ...options,
  });
}
