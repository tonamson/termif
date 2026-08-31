import React from 'react'

export type IconName =
  | 'close'
  | 'add'
  | 'play_arrow'
  | 'edit'
  | 'delete'
  | 'folder'
  | 'description'
  | 'refresh'
  | 'download'
  | 'upload'
  | 'terminal'

const ICON_PATHS: Record<IconName, string> = {
  "close": "<path d=\"m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z\"/>",
  "add": "<path d=\"M440-440H200v-80h240v-240h80v240h240v80H520v240h-80v-240Z\"/>",
  "play_arrow": "<path d=\"M320-200v-560l440 280-440 280Zm80-280Zm0 134 210-134-210-134v268Z\"/>",
  "edit": "<path d=\"M200-200h57l391-391-57-57-391 391v57Zm-80 80v-170l528-527q12-11 26.5-17t30.5-6q16 0 31 6t26 18l55 56q12 11 17.5 26t5.5 30q0 16-5.5 30.5T817-647L290-120H120Zm640-584-56-56 56 56Zm-141 85-28-29 57 57-29-28Z\"/>",
  "delete": "<path d=\"M280-120q-33 0-56.5-23.5T200-200v-520h-40v-80h200v-40h240v40h200v80h-40v520q0 33-23.5 56.5T680-120H280Zm400-600H280v520h400v-520ZM360-280h80v-360h-80v360Zm160 0h80v-360h-80v360ZM280-720v520-520Z\"/>",
  "folder": "<path d=\"M160-160q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800h240l80 80h320q33 0 56.5 23.5T880-640v400q0 33-23.5 56.5T800-160H160Zm0-80h640v-400H447l-80-80H160v480Zm0 0v-480 480Z\"/>",
  "description": "<path d=\"M320-240h320v-80H320v80Zm0-160h320v-80H320v80ZM240-80q-33 0-56.5-23.5T160-160v-640q0-33 23.5-56.5T240-880h320l240 240v480q0 33-23.5 56.5T720-80H240Zm280-520v-200H240v640h480v-440H520ZM240-800v200-200 640-640Z\"/>",
  "refresh": "<path d=\"M480-160q-134 0-227-93t-93-227q0-134 93-227t227-93q69 0 132 28.5T720-690v-110h80v280H520v-80h168q-32-56-87.5-88T480-720q-100 0-170 70t-70 170q0 100 70 170t170 70q77 0 139-44t87-116h84q-28 106-114 173t-196 67Z\"/>",
  "download": "<path d=\"M480-320 280-520l56-58 104 104v-326h80v326l104-104 56 58-200 200ZM240-160q-33 0-56.5-23.5T160-240v-120h80v120h480v-120h80v120q0 33-23.5 56.5T720-160H240Z\"/>",
  "upload": "<path d=\"M440-320v-326L336-542l-56-58 200-200 200 200-56 58-104-104v326h-80ZM240-160q-33 0-56.5-23.5T160-240v-120h80v120h480v-120h80v120q0 33-23.5 56.5T720-160H240Z\"/>",
  "terminal": "<path d=\"M160-160q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800h640q33 0 56.5 23.5T880-720v480q0 33-23.5 56.5T800-160H160Zm0-80h640v-480H160v480Zm80-80h160v-60H240v60Zm0-120 120-120-120-120 42-42 162 162-162 162-42-42Zm-80 200v-480 480Z\"/>"
}

export interface IconProps {
  name: IconName
  size?: number | string
  className?: string
  title?: string
}

export function Icon({ name, size = 16, className = '', title }: IconProps) {
  const path = ICON_PATHS[name] || ''
  const dimension = typeof size === 'number' ? `${size}px` : size

  return (
    <svg
      viewBox="0 -960 960 960"
      width={dimension}
      height={dimension}
      fill="currentColor"
      className={`icon-svg ${className}`.trim()}
      title={title}
      aria-hidden={!title}
      style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}
      dangerouslySetInnerHTML={{ __html: path }}
    />
  )
}
