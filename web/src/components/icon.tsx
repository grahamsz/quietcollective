import { ICONS } from "./icons";

type IconProps = {
  name: keyof typeof ICONS | string;
  className?: string;
};

/** Renders a Lucide-backed icon for Preact components and island-rendered controls. */
export function Icon({ name, className = "" }: IconProps) {
  const body = ICONS[name as keyof typeof ICONS];
  if (!body) return null;
  const classes = `icon icon-${name}${className ? ` ${className}` : ""}`;
  return (
    <svg
      class={classes}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      dangerouslySetInnerHTML={{ __html: body }}
    />
  );
}
