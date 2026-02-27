import * as React from 'react';

import { cn } from '../../lib/utils';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        'flex min-h-[80px] w-full rounded-md border border-slate/25 bg-paper/70 px-3 py-2 text-sm backdrop-blur-md placeholder:text-slate/60 focus-visible:border-slate/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate/35 disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      ref={ref}
      {...props}
    />
  );
});
Textarea.displayName = 'Textarea';

export { Textarea };
