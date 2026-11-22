import type { ReactNode } from "react";

function Icon({ children, size = 18 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

type Props = { size?: number };

export const CheckIcon = ({ size }: Props) => (
  <Icon size={size}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Icon>
);

export const CrossIcon = ({ size }: Props) => (
  <Icon size={size}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Icon>
);

export const AlertIcon = ({ size }: Props) => (
  <Icon size={size}>
    <path d="M12 3.5L2.5 20h19L12 3.5z" />
    <path d="M12 10v4.5M12 17.2v.3" />
  </Icon>
);

export const LockIcon = ({ size }: Props) => (
  <Icon size={size}>
    <rect x="5" y="11" width="14" height="9" />
    <path d="M8 11V8a4 4 0 018 0v3" />
  </Icon>
);

export const FileIcon = ({ size }: Props) => (
  <Icon size={size}>
    <path d="M6 3h8l4 4v14H6V3z" />
    <path d="M14 3v4h4M9 12h6M9 16h6" />
  </Icon>
);

export const ImageIcon = ({ size }: Props) => (
  <Icon size={size}>
    <rect x="3.5" y="5" width="17" height="14" />
    <circle cx="9" cy="10" r="1.6" />
    <path d="M4 17l5-4.5 3.5 3 3-2.5 4.5 4" />
  </Icon>
);

export const DatasetIcon = ({ size }: Props) => (
  <Icon size={size}>
    <ellipse cx="12" cy="6" rx="7" ry="2.8" />
    <path d="M5 6v6c0 1.5 3.1 2.8 7 2.8s7-1.300 7-2.800V6M5 12v6c0 1.500 3.100 2.800 7 2.800s7-1.300 7-2.800v-6" />
  </Icon>
);

export const RecordIcon = ({ size }: Props) => (
  <Icon size={size}>
    <rect x="4" y="4" width="16" height="16" />
    <path d="M12 8.5v7M8.500 12h7" />
  </Icon>
);

export const SealIcon = ({ size }: Props) => (
  <Icon size={size}>
    <path d="M12 3l7 3v5.500c0 4.300-2.900 7.800-7 9.500-4.100-1.700-7-5.200-7-9.500V6l7-3z" />
    <path d="M9 12l2.200 2.200L15 10.500" />
  </Icon>
);

export const TrashIcon = ({ size }: Props) => (
  <Icon size={size}>
    <path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13" />
  </Icon>
);

export const UploadIcon = ({ size }: Props) => (
  <Icon size={size}>
    <path d="M12 16V4M7 9l5-5 5 5M4 20h16" />
  </Icon>
);

export const DownloadIcon = ({ size }: Props) => (
  <Icon size={size}>
    <path d="M12 4v12M7 11l5 5 5-5M4 20h16" />
  </Icon>
);

export const PeopleIcon = ({ size }: Props) => (
  <Icon size={size}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3 20c0-3.300 2.700-6 6-6s6 2.700 6 6M16 5.200a3.200 3.200 0 010 5.600M18 14.500c1.800.900 3 2.900 3 5.500" />
  </Icon>
);

export const LinkIcon = ({ size }: Props) => (
  <Icon size={size}>
    <path d="M10 14a4 4 0 005.700 0l3-3a4 4 0 00-5.700-5.700l-1 1M14 10a4 4 0 00-5.700 0l-3 3a4 4 0 005.700 5.700l1-1" />
  </Icon>
);

export const ChartIcon = ({ size }: Props) => (
  <Icon size={size}>
    <path d="M4 4v16h16M8 16v-4M12 16V8M16 16v-6" />
  </Icon>
);

export const KeyIcon = ({ size }: Props) => (
  <Icon size={size}>
    <circle cx="8" cy="15" r="4" />
    <path d="M11 12l9-9M16 7l3 3M14 9l2 2" />
  </Icon>
);

export const ExitIcon = ({ size }: Props) => (
  <Icon size={size}>
    <path d="M10 4H5v16h5M15 8l4 4-4 4M9 12h10" />
  </Icon>
);

export const BuildingIcon = ({ size }: Props) => (
  <Icon size={size}>
    <path d="M5 21V4h10v17M15 9h4v12M3 21h18M8.500 8h3M8.500 12h3M8.500 16h3" />
  </Icon>
);

export const BackIcon = ({ size }: Props) => (
  <Icon size={size}>
    <path d="M14 6l-6 6 6 6" />
  </Icon>
);

export const PersonIcon = ({ size }: Props) => (
  <Icon size={size}>
    <circle cx="12" cy="8" r="3.500" />
    <path d="M5 20c0-3.900 3.100-7 7-7s7 3.100 7 7" />
  </Icon>
);

export const HashIcon = ({ size }: Props) => (
  <Icon size={size}>
    <path d="M9 4L7 20M17 4l-2 16M4.500 9h16M3.500 15h16" />
  </Icon>
);

export const TreeIcon = ({ size }: Props) => (
  <Icon size={size}>
    <rect x="9.500" y="3" width="5" height="5" />
    <rect x="3" y="16" width="5" height="5" />
    <rect x="16" y="16" width="5" height="5" />
    <path d="M12 8v4M5.500 16v-4h13v4" />
  </Icon>
);

export const ClockIcon = ({ size }: Props) => (
  <Icon size={size}>
    <circle cx="12" cy="12" r="8.500" />
    <path d="M12 7.500V12l3 2" />
  </Icon>
);

export const QuestionIcon = ({ size }: Props) => (
  <Icon size={size}>
    <circle cx="12" cy="12" r="8.500" />
    <path d="M9.500 9.500a2.500 2.500 0 114 2c-.900.700-1.500 1.200-1.500 2.300M12 16.800v.200" />
  </Icon>
);
