import type { ComponentPropsWithoutRef, MouseEvent } from "react";
import { navigate } from "../router";

interface LinkProps extends ComponentPropsWithoutRef<"a"> {
  href: string;
  replace?: boolean;
}

/** An <a> that navigates client-side for plain left clicks and behaves normally otherwise. */
export function Link({ href, replace, onClick, target, ...rest }: LinkProps) {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      (target && target !== "_self")
    ) {
      return;
    }
    event.preventDefault();
    navigate(href, { replace });
  };
  return <a href={href} target={target} onClick={handleClick} {...rest} />;
}
