import type { ReactNode } from 'react';

function Icon({ children, size = 18, fill = 'none' }: { children: ReactNode; size?: number; fill?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export const Logo = () => (
  <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="#F0A43A" strokeWidth={2} aria-hidden="true">
    <rect x="3" y="5" width="13" height="15" rx="2" />
    <path d="M8 3h11a2 2 0 0 1 2 2v12" />
  </svg>
);
export const First = () => <Icon><path d="M6 5v14M18 6l-8 6 8 6z" /></Icon>;
export const Prev = () => <Icon><path d="M15 6l-6 6 6 6" /></Icon>;
export const Next = () => <Icon><path d="M9 6l6 6-6 6" /></Icon>;
export const Last = () => <Icon><path d="M18 5v14M6 6l8 6-8 6z" /></Icon>;
export const Play = () => <Icon fill="currentColor"><path d="M7 5l12 7-12 7z" /></Icon>;
export const Pause = () => <Icon fill="currentColor"><path d="M7 5h3v14H7zM14 5h3v14h-3z" /></Icon>;
export const Brush = () => <Icon size={20}><path d="M18 3l3 3-9 9-4 1 1-4z" /><path d="M7 17c-2 0-3 1.5-3 4 2.5 0 4-1 4-3" /></Icon>;
export const Eraser = () => <Icon size={20}><path d="M7 20h13" /><path d="M4 15l9-9 6 6-8 8H8z" /></Icon>;
export const Undo = () => <Icon size={20}><path d="M9 14L4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" /></Icon>;
export const Redo = () => <Icon size={20}><path d="M15 14l5-5-5-5" /><path d="M20 9H10a6 6 0 0 0 0 12h3" /></Icon>;
export const Eye = () => <Icon size={16}><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></Icon>;
export const EyeOff = () => <Icon size={16}><path d="M3 3l18 18" /><path d="M10.6 5.1A10 10 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3.2 3.9M6.6 6.6C3.8 8.4 2 12 2 12s4 7 10 7a9.7 9.7 0 0 0 5.4-1.6" /></Icon>;
export const Lock = () => <Icon size={15}><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0" /></Icon>;
export const Unlock = () => <Icon size={15}><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 7.5-2" /></Icon>;
export const Plus = () => <Icon size={16}><path d="M12 5v14M5 12h14" /></Icon>;
export const Trash = () => <Icon size={16}><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></Icon>;
export const Up = () => <Icon size={16}><path d="M6 15l6-6 6 6" /></Icon>;
export const Down = () => <Icon size={16}><path d="M6 9l6 6 6-6" /></Icon>;
export const Close = () => <Icon><path d="M6 6l12 12M18 6L6 18" /></Icon>;
export const More = () => <Icon><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></Icon>;
export const Line = () => <Icon size={20}><path d="M5 19L19 5" /></Icon>;
export const Rect = () => <Icon size={20}><rect x="4" y="6" width="16" height="12" rx="1" /></Icon>;
export const Ellipse = () => <Icon size={20}><ellipse cx="12" cy="12" rx="8" ry="6" /></Icon>;
export const Bucket = () => <Icon size={20}><path d="M5 11l7-7 7 7-7 7z" /><path d="M5 11h14" /><path d="M20 15c0 1.5-1 3-1 3s-1-1.5-1-3a1 1 0 0 1 2 0z" /></Icon>;
export const Dropper = () => <Icon size={20}><path d="M14 4l6 6" /><path d="M17 7l-9 9-3 1 1-3 9-9" /><path d="M15 3l6 6" /></Icon>;
export const Lasso = () => <Icon size={20}><ellipse cx="12" cy="9" rx="8" ry="5" strokeDasharray="3 2.5" /><path d="M7 13c-1 2 0 4 2 4s2 2 1 4" /></Icon>;
export const Liquify = () => <Icon size={20}><path d="M4 8c3-3 6 3 9 0s5-2 7 0" /><path d="M4 14c3-3 6 3 9 0s5-2 7 0" /><path d="M9 20c1-2 3-2 4 0" /></Icon>;
export const Smudge = () => <Icon size={20}><path d="M8 3c0 4 0 6 2 8l6 6a2.5 2.5 0 0 1-3.5 3.5l-6-6C4.5 12.5 4 9 6 6" /><path d="M14 4c2 1 3 2 4 4" /></Icon>;
export const Blur = () => <Icon size={20}><path d="M12 3c3 4 6 7 6 11a6 6 0 0 1-12 0c0-4 3-7 6-11z" /><path d="M9 14h6M10 17h4" strokeDasharray="1.5 1.5" /></Icon>;
export const Minus = () => <Icon size={16}><path d="M5 12h14" /></Icon>;
export const RotateLeft = () => <Icon size={16}><path d="M4 4v5h5" /><path d="M4.5 9A8 8 0 1 1 6 17" /></Icon>;
export const RotateRight = () => <Icon size={16}><path d="M20 4v5h-5" /><path d="M19.5 9A8 8 0 1 0 18 17" /></Icon>;
export const Mirror = () => <Icon size={16}><path d="M12 3v18" strokeDasharray="2 2" /><path d="M9 7L3 17h6zM15 7l6 10h-6z" /></Icon>;
export const Copy = () => <Icon size={16}><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" /></Icon>;
export const Camera = () => <Icon size={20}><rect x="3" y="7" width="13" height="11" rx="2" /><path d="M16 11l5-3v9l-5-3" /></Icon>;
export const Sound = () => <Icon size={16}><path d="M4 9v6h4l5 4V5L8 9z" /><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11" /></Icon>;
export const Mute = () => <Icon size={16}><path d="M4 9v6h4l5 4V5L8 9z" /><path d="M17 9l5 6M22 9l-5 6" /></Icon>;
export const Diamond = () => <Icon size={12} fill="currentColor"><path d="M12 3l9 9-9 9-9-9z" /></Icon>;
export const Folder = () => <Icon size={16}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></Icon>;
export const Ruler = () => <Icon size={16}><path d="M3 15L15 3l6 6L9 21z" /><path d="M7 11l2 2M10 8l2 2M13 5l2 2" /></Icon>;
export const Image = () => <Icon size={16}><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="M21 17l-5-5-9 8" /></Icon>;
export const PaintLayer = () => <Icon size={16}><path d="M4 20c3 0 5-2 5-4a3 3 0 0 0-5 0c0 1 .5 2 0 4z" /><path d="M9 14l10-10 1 1-10 10" /></Icon>;
export const Text = () => <Icon><path d="M5 6V4h14v2M12 4v16M9 20h6" /></Icon>;
export const Keyboard = () => <Icon size={16}><rect x="2" y="6" width="20" height="12" rx="2" /><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" /></Icon>;
export const Sliders = () => <Icon size={18}><path d="M4 7h9M17 7h3M4 17h3M11 17h9" /><circle cx="15" cy="7" r="2" /><circle cx="9" cy="17" r="2" /></Icon>;
export const Check = () => <Icon size={14}><path d="M5 12.5l4.5 4.5L19 7.5" /></Icon>;
export const Warning = () => <Icon size={14}><path d="M12 4l9 16H3z" /><path d="M12 10v4M12 17h.01" /></Icon>;
export const PauseSmall = () => <Icon size={14}><path d="M9 6v12M15 6v12" /></Icon>;
export const Spinner = () => <Icon size={14}><path d="M12 3a9 9 0 1 0 9 9" /></Icon>;
export const FileNew = () => <Icon><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M12 11v6M9 14h6" /></Icon>;
export const Save = () => <Icon><path d="M5 3h11l3 3v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" /><path d="M7 3v5h8V3M7 21v-7h10v7" /></Icon>;
export const PictureInPicture = () => <Icon><rect x="3" y="5" width="18" height="14" rx="2" /><rect x="12" y="11" width="6" height="5" rx="1" /></Icon>;
export const Timelapse = () => <Icon><circle cx="12" cy="13" r="8" /><path d="M12 9v4l3 2M10 2h4" /></Icon>;
export const Adjust = () => <Icon><circle cx="12" cy="12" r="9" /><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" /></Icon>;
export const Hand = () => <Icon><path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12M11 11.5v-7a1.5 1.5 0 0 1 3 0V12M14 11.5V6.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1a6 6 0 0 1-4.8-2.4L3.5 15a1.5 1.5 0 0 1 2.3-1.9L8 15" /></Icon>;
export const Layers = () => <Icon><path d="M12 3l9 5-9 5-9-5z" /><path d="M3 13l9 5 9-5" /></Icon>;
export const Unlink = () => <Icon><path d="M9 15l-2 2a3 3 0 0 1-4-4l3-3a3 3 0 0 1 4 0M15 9l2-2a3 3 0 0 1 4 4l-3 3a3 3 0 0 1-4 0M4 4l16 16" /></Icon>;
