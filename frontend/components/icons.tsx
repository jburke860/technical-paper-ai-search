import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function IconBase({ children, ...props }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {children}
    </svg>
  );
}

export function BookIcon(props: IconProps) {
  return <IconBase {...props}><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z" /><path d="M4 5.5v15M8 7h8M8 11h6" /></IconBase>;
}

export function SearchIcon(props: IconProps) {
  return <IconBase {...props}><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 4 4" /></IconBase>;
}

export function SparkIcon(props: IconProps) {
  return <IconBase {...props}><path d="m12 3 1.25 4.25L17.5 8.5l-4.25 1.25L12 14l-1.25-4.25L6.5 8.5l4.25-1.25zM18.5 14l.65 2.35L21.5 17l-2.35.65L18.5 20l-.65-2.35L15.5 17l2.35-.65z" /></IconBase>;
}

export function FileIcon(props: IconProps) {
  return <IconBase {...props}><path d="M6 2.75h8l4 4V21.25H6z" /><path d="M14 2.75v4h4M9 12h6M9 16h5" /></IconBase>;
}

export function LayersIcon(props: IconProps) {
  return <IconBase {...props}><path d="m12 3 9 5-9 5-9-5z" /><path d="m3 12 9 5 9-5M3 16l9 5 9-5" /></IconBase>;
}

export function MenuIcon(props: IconProps) {
  return <IconBase {...props}><path d="M4 7h16M4 12h16M4 17h16" /></IconBase>;
}

export function CloseIcon(props: IconProps) {
  return <IconBase {...props}><path d="m6 6 12 12M18 6 6 18" /></IconBase>;
}

export function ArrowIcon(props: IconProps) {
  return <IconBase {...props}><path d="M5 12h14M14 7l5 5-5 5" /></IconBase>;
}

export function ExternalIcon(props: IconProps) {
  return <IconBase {...props}><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 13v6H5V6h6" /></IconBase>;
}

export function PanelIcon(props: IconProps) {
  return <IconBase {...props}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M14 4v16" /></IconBase>;
}

export function CheckIcon(props: IconProps) {
  return <IconBase {...props}><path d="m5 12 4 4 10-10" /></IconBase>;
}

export function CopyIcon(props: IconProps) {
  return <IconBase {...props}><rect x="8" y="8" width="11" height="11" rx="2" /><path d="M16 8V5H5v11h3" /></IconBase>;
}

export function HistoryIcon(props: IconProps) {
  return <IconBase {...props}><path d="M4 12a8 8 0 1 0 2.3-5.7L4 8.6" /><path d="M4 4v4.6h4.6M12 8v5l3 2" /></IconBase>;
}

export function SettingsIcon(props: IconProps) {
  return <IconBase {...props}><path d="M4 6h10M18 6h2M4 12h3M11 12h9M4 18h7M15 18h5" /><circle cx="16" cy="6" r="2" /><circle cx="9" cy="12" r="2" /><circle cx="13" cy="18" r="2" /></IconBase>;
}

export function RefreshIcon(props: IconProps) {
  return <IconBase {...props}><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6.1 8.5A7 7 0 0 1 18.8 7M17.9 15.5A7 7 0 0 1 5.2 17" /></IconBase>;
}

export function ChevronIcon(props: IconProps) {
  return <IconBase {...props}><path d="m8 10 4 4 4-4" /></IconBase>;
}
