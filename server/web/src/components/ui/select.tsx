// shadcn/ui Select composition on Radix, styled with the journal's CSS tokens.
import type { ComponentProps } from 'react';
import * as Primitive from '@radix-ui/react-select';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';

export const Select = Primitive.Root;
export const SelectValue = Primitive.Value;

export function SelectTrigger({ children, ...props }: ComponentProps<typeof Primitive.Trigger>) {
  return (
    <Primitive.Trigger className="select-trigger" {...props}>
      {children}
      <Primitive.Icon asChild><ChevronDown size={16} /></Primitive.Icon>
    </Primitive.Trigger>
  );
}

export function SelectContent({ children, ...props }: ComponentProps<typeof Primitive.Content>) {
  return (
    <Primitive.Portal>
      <Primitive.Content className="select-content" position="popper" sideOffset={6} {...props}>
        <Primitive.ScrollUpButton className="select-scroll"><ChevronUp size={16} /></Primitive.ScrollUpButton>
        <Primitive.Viewport className="select-viewport">{children}</Primitive.Viewport>
        <Primitive.ScrollDownButton className="select-scroll"><ChevronDown size={16} /></Primitive.ScrollDownButton>
      </Primitive.Content>
    </Primitive.Portal>
  );
}

export function SelectItem({ children, ...props }: ComponentProps<typeof Primitive.Item>) {
  return (
    <Primitive.Item className="select-item" {...props}>
      <Primitive.ItemText>{children}</Primitive.ItemText>
      <Primitive.ItemIndicator><Check size={16} /></Primitive.ItemIndicator>
    </Primitive.Item>
  );
}
