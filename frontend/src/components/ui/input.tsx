import * as React from 'react';

import { cn } from '../../lib/utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, type, ...props }, ref) => {
  return (
    <input
      type={type}
      className={cn(
        'flex h-9 w-full rounded-md border border-slate/25 bg-paper/70 px-3 py-1 text-sm backdrop-blur-md ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-slate/60 focus-visible:border-slate/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate/35 disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      ref={ref}
      {...props}
    />
  );
});
Input.displayName = 'Input';

export { Input };
